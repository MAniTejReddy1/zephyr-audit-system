from datetime import datetime, timezone
from typing import Annotated, List
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, func, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.db.models import TestCaseState, FolderMap, UserDirectory, AuditLog
from app.schemas.schemas import TestCaseFullOut, FolderOut, FolderWithCount, UserProfile, ZephyrAuditLog
from app.api.dependencies import require_api_key
from app.services.coverage import audit_actions_for_metric_key

settings = get_settings()

router = APIRouter(prefix="/api", tags=["testcases"])


def _parse_query_datetime(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime: {value}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@router.get("/testcases", dependencies=[Depends(require_api_key)])
async def get_testcases(
    db: AsyncSession = Depends(get_db),
    limit: Annotated[int, Query(ge=1, le=settings.api_max_limit)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: str | None = Query(default=None),
    folder_id: int | None = Query(default=None),
    folder_path: str | None = Query(default=None),
    include_deleted: bool = False,
    automated: str | None = Query(default=None),
    changed_action: str | None = Query(default=None),
    changed_from: str | None = Query(default=None),
    changed_to: str | None = Query(default=None),
    zephyr_keys: str | None = Query(default=None),
):
    auto_norm = automated.strip().lower() if automated else None
    ck = changed_action.strip().lower() if changed_action else ""
    explicit_keys_list = [x.strip() for x in (zephyr_keys or "").split(",") if x.strip()]

    # Include deleted/archived cases whenever a changed_action filter is specified,
    # since a case matching the action may have been subsequently deleted.
    include_deleted_eff = include_deleted or bool(ck) or bool(explicit_keys_list)

    stmt = select(TestCaseState).order_by(TestCaseState.zephyr_key.asc())

    if not include_deleted_eff:
        stmt = stmt.where(TestCaseState.is_deleted.is_(False))
    if search:
        stmt = stmt.where(or_(TestCaseState.name.ilike(f"%{search}%"), TestCaseState.zephyr_key.ilike(f"%{search}%")))
    if folder_id:
        stmt = stmt.where(TestCaseState.folder_id == folder_id)
    if folder_path:
        stmt = stmt.where(TestCaseState.folder_path.ilike(f"{folder_path}%"))

    automated_json_expr = """(
(lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
)"""
    no_status_expr = """(
(lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) NOT IN ('yes','true','1','y','no','false','0','n'))
AND (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) NOT IN ('yes','true','1','y','no','false','0','n'))
)"""
    not_automated_expr = f"""(
(
  lower(trim(coalesce(raw_snapshot #>> '{{customFields,is_automated_in_api}}', ''))) IN ('no','false','0','n')
  OR lower(trim(coalesce(raw_snapshot #>> '{{customFields,is_automated_in_app}}', ''))) IN ('no','false','0','n')
)
AND NOT {automated_json_expr}
)"""
    if auto_norm in {"yes", "y", "true", "1"}:
        stmt = stmt.where(text(automated_json_expr))
    elif auto_norm in {"no", "n", "false", "0"}:
        # Explicit "not automated" — has a "no" value (NOT the same as "none")
        stmt = stmt.where(text(not_automated_expr))
    elif auto_norm == "none":
        # No automation status set at all
        stmt = stmt.where(or_(text(no_status_expr), TestCaseState.raw_snapshot.is_(None)))
    elif auto_norm == "manual":
        stmt = stmt.where(or_(text(not_automated_expr), text(no_status_expr), TestCaseState.raw_snapshot.is_(None)))

    log_fil: list = []
    cf_dt = _parse_query_datetime(changed_from)
    ct_dt = _parse_query_datetime(changed_to)
    if cf_dt:
        log_fil.append(AuditLog.detected_at >= cf_dt)
    if ct_dt:
        log_fil.append(AuditLog.detected_at <= ct_dt)
    if ck:
        try:
            acts_t = audit_actions_for_metric_key(ck)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="changed_action must be created|moved_in|moved_out|deleted|updated") from exc
        log_fil.append(AuditLog.action.in_(acts_t))

    if log_fil:
        keys_subq = select(AuditLog.zephyr_key).where(*log_fil).distinct()
        stmt = stmt.where(TestCaseState.zephyr_key.in_(keys_subq))

    if explicit_keys_list:
        stmt = stmt.where(TestCaseState.zephyr_key.in_(explicit_keys_list))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    cases = result.scalars().all()

    return {
        "items": [TestCaseFullOut.model_validate(c).model_dump() for c in cases],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/testcases/{key}", dependencies=[Depends(require_api_key)])
async def get_testcase_detail(key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestCaseState).where(TestCaseState.zephyr_key == key))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail=f"Test case {key} not found")
    return TestCaseFullOut.model_validate(case).model_dump()


@router.get("/testcases/{key}/zephyr_history", response_model=List[ZephyrAuditLog], dependencies=[Depends(require_api_key)])
async def get_zephyr_testcase_history(key: str):
    if not settings.zephyr_base_url or not settings.zephyr_api_token:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Zephyr API not configured.")
    
    headers = {"Authorization": f"Bearer {settings.zephyr_api_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(base_url=settings.zephyr_base_url, headers=headers, timeout=settings.request_timeout_seconds) as client:
        try:
            response = await client.get(f"/testcases/{key}/history")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Zephyr API error: {e.response.text}") from e
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Network error: {e}") from e


@router.get("/folders", dependencies=[Depends(require_api_key)])
async def get_folders(
    db: AsyncSession = Depends(get_db),
    scoped: bool = Query(default=True),
    with_counts: bool = Query(default=True),
):
    stmt = select(FolderMap).order_by(FolderMap.name.asc())
    
    if scoped and settings.zephyr_parent_folder_id:
        parent_folder = await db.get(FolderMap, settings.zephyr_parent_folder_id)
        if parent_folder:
            parent_path = parent_folder.full_path
            stmt = stmt.where(or_(
                FolderMap.folder_id == settings.zephyr_parent_folder_id,
                FolderMap.full_path.like(f"{parent_path} > %")
            ))
    
    result = await db.execute(stmt)
    folders = result.scalars().all()
    
    if with_counts:
        count_stmt = select(
            TestCaseState.folder_id,
            func.count(TestCaseState.id).label('count')
        ).where(TestCaseState.is_deleted.is_(False)).group_by(TestCaseState.folder_id)
        count_result = await db.execute(count_stmt)
        counts = {row.folder_id: row.count for row in count_result}
        
        return [{
            "folder_id": f.folder_id,
            "name": f.name,
            "full_path": f.full_path,
            "parent_id": f.parent_id,
            "tribe": f.tribe,
            "test_case_count": counts.get(f.folder_id, 0)
        } for f in folders]
    
    return [FolderOut.model_validate(f).model_dump() for f in folders]


@router.get("/actors", response_model=list[UserProfile], dependencies=[Depends(require_api_key)])
async def get_actors(db: AsyncSession = Depends(get_db)):
    stmt = select(UserDirectory).order_by(UserDirectory.display_name.asc())
    result = await db.execute(stmt)
    return result.scalars().all()
