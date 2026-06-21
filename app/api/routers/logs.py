from datetime import datetime, time, timezone
from typing import Annotated, Any
from collections import defaultdict
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, func, or_, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.db.models import AuditLog, SyncRun
from app.schemas.schemas import AuditLogOut
from app.api.dependencies import require_api_key
from app.utils.audit import sanitize_for_storage

settings = get_settings()

router = APIRouter(prefix="/api", tags=["logs"])


def clause_for_audit_action_param(audit_action: str | None):
    """Map sidebar drilldown audit_action to AuditLog predicates (aligned with dashboard semantics)."""
    if not audit_action:
        return None
    u = audit_action.strip().upper()
    if u in {"", "ALL", "ANY"}:
        return None
    if u in {"MOVED_IN", "MOVED_IN_SCOPE"}:
        return AuditLog.action.in_(["MOVED_IN", "RESTORED"])
    if u == "MOVED_OUT":
        return AuditLog.action == "MOVED"
    if u in {"CREATED", "UPDATED", "DELETED", "ARCHIVED", "RESTORED", "MOVED"}:
        return AuditLog.action == u
    raise HTTPException(status_code=400, detail=f"Unsupported audit_action: {audit_action}")


def _safe_log(log: AuditLog) -> AuditLogOut:
    return AuditLogOut(
        id=log.id,
        zephyr_key=log.zephyr_key,
        project_key=log.project_key,
        action=log.action,
        actor_account=log.actor_account,
        actor_name=log.actor_name,
        poll_run_id=log.poll_run_id,
        changed_fields=log.changed_fields or [],
        diff_before=sanitize_for_storage(log.diff_before) if log.diff_before else {},
        diff_after=sanitize_for_storage(log.diff_after) if log.diff_after else {},
        folder_before=log.folder_before,
        folder_after=log.folder_after,
        detected_at=log.detected_at,
        alerted=log.alerted,
        alerted_at=log.alerted_at,
    )


@router.get("/polls", dependencies=[Depends(require_api_key)])
async def get_polls(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    folder_path: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    from_timestamp: datetime | None = Query(default=None, alias="from"),
    to_timestamp: datetime | None = Query(default=None, alias="to"),
    audit_action: str | None = Query(default=None, description="CREATED | MOVED_OUT | MOVED_IN | DELETED | UPDATED"),
    zephyr_keys: str | None = Query(default=None, description="Comma-separated Zephyr keys"),
):
    filters = []

    if folder_path:
        filters.append(
            or_(
                AuditLog.folder_after.ilike(f"%{folder_path}%"),
                AuditLog.folder_before.ilike(f"%{folder_path}%"),
            )
        )
    if actor:
        filters.append(or_(AuditLog.actor_name.ilike(f"%{actor}%"), AuditLog.actor_account.ilike(f"%{actor}%")))
    if from_timestamp:
        filters.append(AuditLog.detected_at >= from_timestamp)
    if to_timestamp:
        filters.append(AuditLog.detected_at <= to_timestamp)

    if audit_action:
        ac = clause_for_audit_action_param(audit_action)
        if ac is not None:
            filters.append(ac)

    key_list = [k.strip() for k in (zephyr_keys or "").split(",") if k.strip()]
    if key_list:
        filters.append(AuditLog.zephyr_key.in_(key_list))

    run_id_expr = func.coalesce(func.cast(AuditLog.poll_run_id, String), func.cast(func.date_trunc('minute', AuditLog.detected_at), String))
    group_stmt = (
        select(run_id_expr.label("poll_id"), func.max(AuditLog.detected_at).label("latest_at"))
        .where(*filters)
        .group_by(run_id_expr)
        .order_by(func.max(AuditLog.detected_at).desc())
    )
    group_result = await db.execute(group_stmt)
    poll_ids = [row.poll_id for row in group_result.all()]

    logs = []
    if poll_ids:
        stmt = select(AuditLog).where(*filters, run_id_expr.in_(poll_ids)).order_by(AuditLog.detected_at.desc())
        result = await db.execute(stmt)
        logs = result.scalars().all()

    run_ids = [log.poll_run_id for log in logs if log.poll_run_id]
    run_map = {}
    if run_ids:
        run_result = await db.execute(select(SyncRun).where(SyncRun.id.in_(run_ids)))
        run_map = {str(run.id): run for run in run_result.scalars().all()}
    
    polls_dict: dict[str, dict] = {}

    if not folder_path and not actor and not audit_action and not key_list:
        run_filters = []
        if from_timestamp:
            run_filters.append(SyncRun.started_at >= from_timestamp)
        if to_timestamp:
            run_filters.append(SyncRun.started_at <= to_timestamp)
        run_result = await db.execute(
            select(SyncRun)
            .where(*run_filters)
            .order_by(SyncRun.started_at.desc())
        )
        for run in run_result.scalars().all():
            poll_id = str(run.id)
            polls_dict[poll_id] = {
                "poll_id": poll_id,
                "poll_timestamp": run.started_at,
                "completed_at": run.completed_at,
                "status": run.status,
                "source": run.source,
                "message": run.message,
                "total_fetched": run.total_fetched,
                "unchanged_count": run.unchanged_count,
                "folders": {},
                "total_changes": 0,
                "actors": set(),
                "actions_summary": defaultdict(int),
            }
    
    for log in logs:
        if log.poll_run_id:
            poll_id = str(log.poll_run_id)
            run = run_map.get(poll_id)
            poll_time = run.started_at if run else log.detected_at.replace(second=0, microsecond=0)
        else:
            poll_time = log.detected_at.replace(second=0, microsecond=0)
            poll_id = poll_time.isoformat()
        
        if poll_id not in polls_dict:
            polls_dict[poll_id] = {
                "poll_id": poll_id,
                "poll_timestamp": poll_time,
                "completed_at": getattr(run_map.get(poll_id), "completed_at", None),
                "status": getattr(run_map.get(poll_id), "status", None),
                "source": getattr(run_map.get(poll_id), "source", "historical"),
                "message": getattr(run_map.get(poll_id), "message", None),
                "total_fetched": getattr(run_map.get(poll_id), "total_fetched", 0),
                "unchanged_count": getattr(run_map.get(poll_id), "unchanged_count", 0),
                "folders": {},
                "total_changes": 0,
                "actors": set(),
                "actions_summary": defaultdict(int),
            }
        
        poll = polls_dict[poll_id]
        folder = log.folder_after or log.folder_before or "Unknown"
        
        if folder not in poll["folders"]:
            poll["folders"][folder] = {"changes": [], "actors": set(), "actions": defaultdict(int)}
        
        poll["folders"][folder]["changes"].append(_safe_log(log).model_dump())
        poll["folders"][folder]["actors"].add(log.actor_name or log.actor_account or "System")
        poll["folders"][folder]["actions"][log.action] += 1
        
        poll["total_changes"] += 1
        if log.actor_name or log.actor_account:
            poll["actors"].add(log.actor_name or log.actor_account)
        poll["actions_summary"][log.action] += 1
    
    global_rank_result = await db.execute(
        select(
            SyncRun.id,
            func.row_number().over(order_by=SyncRun.started_at).label("global_num"),
        )
    )
    global_poll_number: dict[str, int] = {
        str(row.id): row.global_num for row in global_rank_result.all()
    }

    polls = []
    ordered_polls = sorted(polls_dict.values(), key=lambda item: item["poll_timestamp"], reverse=True)
    total_polls = len(ordered_polls)
    for poll in ordered_polls:
        poll["poll_number"] = global_poll_number.get(poll["poll_id"], None)
    for poll in ordered_polls[offset:offset + limit]:
        for folder in poll["folders"].values():
            folder["actors"] = list(folder["actors"])
            folder["actions"] = dict(folder["actions"])
        poll["actors"] = list(poll["actors"])
        poll["actions_summary"] = dict(poll["actions_summary"])
        polls.append(poll)
    
    return {"items": polls, "total": total_polls, "limit": limit, "offset": offset}


@router.get("/logs", dependencies=[Depends(require_api_key)])
async def get_logs(
    db: AsyncSession = Depends(get_db),
    limit: Annotated[int, Query(ge=1, le=settings.api_max_limit)] = 150,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: str | None = Query(default=None),
    audit_action: str | None = Query(default=None, description="Sidebar drill action: CREATED|UPDATED|MOVED_IN|MOVED_OUT|DELETED"),
    folder: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    from_timestamp: datetime | None = Query(default=None, alias="from"),
    to_timestamp: datetime | None = Query(default=None, alias="to"),
):
    """Return paginated audit log entries with optional filters. Supports sidebar drill via audit_action."""
    stmt = select(AuditLog).order_by(AuditLog.detected_at.desc())

    effective_action_clause = clause_for_audit_action_param(audit_action) if audit_action else None
    if effective_action_clause is not None:
        stmt = stmt.where(effective_action_clause)
    elif action and action not in ("", "ALL"):
        stmt = stmt.where(AuditLog.action == action)

    if folder:
        stmt = stmt.where(or_(
            AuditLog.folder_after.ilike(f"%{folder}%"),
            AuditLog.folder_before.ilike(f"%{folder}%")
        ))
    if actor:
        stmt = stmt.where(or_(
            AuditLog.actor_name.ilike(f"%{actor}%"),
            AuditLog.actor_account.ilike(f"%{actor}%")
        ))
    if from_timestamp:
        stmt = stmt.where(AuditLog.detected_at >= from_timestamp)
    if to_timestamp:
        stmt = stmt.where(AuditLog.detected_at <= to_timestamp)

    count_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = count_result.scalar() or 0

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    items = [_safe_log(log).model_dump() for log in result.scalars().all()]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/logs/{key}/history", response_model=list[AuditLogOut], dependencies=[Depends(require_api_key)])
async def get_test_case_history(key: str, db: AsyncSession = Depends(get_db)):
    """Get audit history for a specific test case. Returns empty array if no history exists."""
    stmt = select(AuditLog).where(AuditLog.zephyr_key == key).order_by(AuditLog.detected_at.desc())
    result = await db.execute(stmt)
    logs = result.scalars().all()
    return [_safe_log(log) for log in logs]


@router.get("/diff", response_model=AuditLogOut, dependencies=[Depends(require_api_key)])
async def get_diff(
    zephyr_key: str = Query(...),
    action: str = Query(...),
    detected_at: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Find a specific audit log by natural key elements to show its detailed diff."""
    # Find matching audit log
    stmt = select(AuditLog).where(
        AuditLog.zephyr_key == zephyr_key,
        AuditLog.action == action,
        AuditLog.detected_at == detected_at
    )
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Audit log entry not found")
    return _safe_log(log)
