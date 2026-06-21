from datetime import datetime, timezone, timedelta, time
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, func, text, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import AsyncSessionLocal, get_db
from app.db.models import FolderMap, TestCaseState, AuditLog, SyncRun
from app.schemas.schemas import ConfigOut, StatsOut
from app.api.dependencies import require_api_key
from app.services.coverage import (
    ensure_calendar_week_opening_snapshot,
    calendar_week_start_utc,
    first_week_snapshot,
    latest_snapshot_in_week,
    compute_inventory_counts,
    deltas_vs_baseline,
)

settings = get_settings()

router = APIRouter(prefix="/api", tags=["core"])


@router.get("/health")
async def health():
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection failed: {str(e)}"
        )


@router.get("/config", response_model=ConfigOut, dependencies=[Depends(require_api_key)])
async def get_config(db: AsyncSession = Depends(get_db)):
    parent_folder_name = None
    if settings.zephyr_parent_folder_id:
        folder = await db.get(FolderMap, settings.zephyr_parent_folder_id)
        if folder:
            parent_folder_name = folder.name
    return {
        "project_key": settings.zephyr_project_key,
        "parent_folder_id": settings.zephyr_parent_folder_id,
        "parent_folder_name": parent_folder_name,
        "base_url": settings.zephyr_base_url,
        "fetch_test_steps": settings.zephyr_fetch_test_steps,
        "archive_status_names": list(settings.archive_status_names),
        "api_max_limit": settings.api_max_limit,
        "poll_step_concurrency": settings.poll_step_concurrency,
    }


@router.get("/stats", response_model=StatsOut, dependencies=[Depends(require_api_key)])
async def get_stats(
    db: AsyncSession = Depends(get_db),
    period: str = Query(default="7d", description="1d|7d|30d|all"),
):
    await ensure_calendar_week_opening_snapshot(db)

    now_utc = datetime.now(timezone.utc)
    week_start_utc = calendar_week_start_utc(now_utc)
    tz_name = getattr(settings, "stats_timezone", "") or ""

    _period = (period or "7d").strip().lower()
    if _period == "1d":
        window_start = now_utc - timedelta(days=1)
        window_label = "Last 24 Hours"
    elif _period == "7d":
        window_start = now_utc - timedelta(days=7)
        window_label = "Last 7 Days"
    elif _period == "30d":
        window_start = now_utc - timedelta(days=30)
        window_label = "Last 30 Days"
    elif _period == "all":
        window_start = datetime(2000, 1, 1, tzinfo=timezone.utc)
        window_label = "All Time"
    else:
        window_start = week_start_utc
        window_label = "This Calendar Week"

    baseline_snapshot = await first_week_snapshot(db)
    latest_snap = await latest_snapshot_in_week(db, week_start_utc)

    total_cases, automated_cases, not_automated_cases, none_cases = await compute_inventory_counts(db)
    manual_cases = not_automated_cases + none_cases
    automated_pct = round((automated_cases / total_cases) * 100) if total_cases else 0
    not_automated_pct = round((not_automated_cases / total_cases) * 100) if total_cases else 0
    none_pct = max(100 - automated_pct - not_automated_pct, 0) if total_cases else 0
    manual_pct = max(100 - automated_pct, 0) if total_cases else 0

    d_automation = deltas_vs_baseline(baseline_snapshot, total_cases, automated_cases, manual_cases)

    out_of_scope_res = await db.execute(
        select(func.count(TestCaseState.id)).where(
            TestCaseState.project_key == settings.zephyr_project_key,
            TestCaseState.is_deleted.is_(True),
        )
    )
    out_of_scope_cases = out_of_scope_res.scalar() or 0

    total_logs_res = await db.execute(select(func.count(AuditLog.id)))
    total_logs = total_logs_res.scalar() or 0

    updates_res = await db.execute(select(func.count(AuditLog.id)).where(AuditLog.action == "UPDATED"))
    updates = updates_res.scalar() or 0

    moved_out_res = await db.execute(select(func.count(AuditLog.id)).where(AuditLog.action == "MOVED"))
    moved_out_events = moved_out_res.scalar() or 0

    moved_in_res = await db.execute(
        select(func.count(AuditLog.id)).where(or_(AuditLog.action == "MOVED_IN", AuditLog.action == "RESTORED"))
    )
    moved_in_events = moved_in_res.scalar() or 0

    deleted_res = await db.execute(select(func.count(AuditLog.id)).where(AuditLog.action == "DELETED"))
    deleted_events = deleted_res.scalar() or 0

    today_start = datetime.combine(datetime.now(timezone.utc).date(), time.min, tzinfo=timezone.utc)
    updates_today_res = await db.execute(
        select(func.count(AuditLog.id)).where(AuditLog.detected_at >= today_start)
    )
    updates_today = updates_today_res.scalar() or 0

    latest_run_res = await db.execute(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(1))
    latest_run = latest_run_res.scalar_one_or_none()
    latest_poll_changes = latest_run.total_logged if latest_run else 0

    legacy_poll_groups_res = await db.execute(
        select(func.count(func.distinct(func.date_trunc("minute", AuditLog.detected_at)))).where(AuditLog.poll_run_id.is_(None))
    )
    legacy_poll_groups = legacy_poll_groups_res.scalar() or 0
    sync_run_count_res = await db.execute(select(func.count(SyncRun.id)))
    sync_run_count = sync_run_count_res.scalar() or 0
    poll_runs = legacy_poll_groups + sync_run_count

    async def _audit_count_inclusive(start_ts: datetime, end_ts_inclusive: datetime, actions: tuple[str, ...]) -> int:
        clause = [
            AuditLog.detected_at >= start_ts,
            AuditLog.detected_at <= end_ts_inclusive,
            AuditLog.action.in_(actions),
        ]
        r = await db.execute(select(func.count(AuditLog.id)).where(*clause))
        return r.scalar() or 0

    async def _prior_cur_delta(actions_tuple: tuple[str, ...]):
        cur = await _audit_count_inclusive(window_start, now_utc, actions_tuple)
        window_duration = now_utc - window_start
        prior_start = window_start - window_duration
        prev = await _audit_count_inclusive(prior_start, window_start, actions_tuple)

        def _delta_pct(prev_n: int, cur_n: int) -> float:
            if prev_n <= 0 and cur_n <= 0:
                return 0.0
            if prev_n <= 0 and cur_n > 0:
                return float(100)
            return round(((cur_n - prev_n) / prev_n) * 100)

        return cur, prev, _delta_pct(prev, cur)

    created_cur, _, created_delta = await _prior_cur_delta(("CREATED",))
    moved_in_cur, _, mi_delta = await _prior_cur_delta(("MOVED_IN", "RESTORED"))
    mo_cur, _, mo_delta = await _prior_cur_delta(("MOVED",))
    del_cur, _, del_delta = await _prior_cur_delta(("DELETED",))
    up_cur, _, up_delta = await _prior_cur_delta(("UPDATED",))

    sum_audit_actions_segment = created_cur + moved_in_cur + mo_cur + del_cur + up_cur

    def share(n: int) -> int:
        return round((n / sum_audit_actions_segment) * 100) if sum_audit_actions_segment else 0

    def drill_payload(metric_key_action: str, audit_action_literal: str) -> dict:
        return {
            "metric_key": metric_key_action,
            "audit_action": audit_action_literal,
            "from_iso": window_start.isoformat(),
            "to_iso": now_utc.isoformat(),
            "timezone": tz_name or "STATS_TIMEZONE",
        }

    def total_cases_inventory_delta_pct() -> float | None:
        if baseline_snapshot is None or not baseline_snapshot.total_cases:
            return None
        b = baseline_snapshot.total_cases
        return round(((total_cases / b - 1) * 100) * 10) / 10

    baseline_total_cases = baseline_snapshot.total_cases if baseline_snapshot else total_cases

    weekly_activity: list[dict[str, Any]] = [
        {
            "key": "total_cases",
            "label": "Total Cases Up To Date",
            "subtitle": f"inventory vs week baseline snapshot ({baseline_total_cases} cases)",
            "count": total_cases,
            "share": None,
            "delta_pct": total_cases_inventory_delta_pct(),
            "drill_audit": drill_payload("total_cases", "ALL"),
            "drill_testcases": {"mode": "all_scoped"},
        },
        {
            "key": "created",
            "label": "New Cases Added",
            "subtitle": "CREATED audit events · calendar week vs prior span",
            "count": created_cur,
            "share": share(created_cur),
            "delta_pct": created_delta,
            "drill_audit": drill_payload("created", "CREATED"),
            "drill_testcases": {
                **drill_payload("created", "CREATED"),
                "changed_action": "created",
            },
        },
        {
            "key": "moved_in",
            "label": "Moved Into Scope",
            "subtitle": "MOVED_IN + RESTORED",
            "count": moved_in_cur,
            "share": share(moved_in_cur),
            "delta_pct": mi_delta,
            "drill_audit": drill_payload("moved_in", "MOVED_IN"),
            "drill_testcases": {**drill_payload("moved_in", "MOVED_IN"), "changed_action": "moved_in"},
        },
        {
            "key": "moved_out",
            "label": "Moved Out of Scope",
            "subtitle": "MOVED (folder exit)",
            "count": mo_cur,
            "share": share(mo_cur),
            "delta_pct": mo_delta,
            "drill_audit": drill_payload("moved_out", "MOVED_OUT"),
            "drill_testcases": {**drill_payload("moved_out", "MOVED_OUT"), "changed_action": "moved_out"},
        },
        {
            "key": "deleted",
            "label": "Archived / Deleted",
            "subtitle": "DELETED",
            "count": del_cur,
            "share": share(del_cur),
            "delta_pct": del_delta,
            "drill_audit": drill_payload("deleted", "DELETED"),
            "drill_testcases": {**drill_payload("deleted", "DELETED"), "changed_action": "deleted"},
        },
        {
            "key": "updated",
            "label": "Field Updates",
            "subtitle": "UPDATED rows",
            "count": up_cur,
            "share": share(up_cur),
            "delta_pct": up_delta,
            "drill_audit": drill_payload("updated", "UPDATED"),
            "drill_testcases": {**drill_payload("updated", "UPDATED"), "changed_action": "updated"},
        },
    ]

    contributor_name_expr = func.coalesce(AuditLog.actor_name, AuditLog.actor_account, "Unknown")
    contributors_res = await db.execute(
        select(
            contributor_name_expr.label("name"),
            func.count(AuditLog.id).label("count"),
        )
        .where(AuditLog.detected_at >= window_start)
        .group_by(contributor_name_expr)
        .order_by(func.count(AuditLog.id).desc())
        .limit(5)
    )
    contributor_rows = contributors_res.all()
    max_contrib = max([row.count for row in contributor_rows] or [1])
    contributors_week = [
        {
            "name": row.name,
            "count": row.count,
            "share": round((row.count / max_contrib) * 100) if max_contrib else 0,
            "is_system": str(row.name).lower() in {"system", "unknown", "unknown modifier", "unassigned"},
        }
        for row in contributor_rows
    ]

    automated_delta_pct_legacy = round(d_automation["automated_delta_pct_pts"]) if isinstance(
        d_automation.get("automated_delta_pct_pts"), (int, float)
    ) else None
    manual_delta_pct_legacy = round(d_automation["manual_delta_pct_pts"]) if isinstance(
        d_automation.get("manual_delta_pct_pts"), (int, float)
    ) else None

    return {
        "total_cases": total_cases,
        "total_logs": total_logs,
        "updates": updates,
        "updates_today": updates_today,
        "active_cases": total_cases,
        "out_of_scope_cases": out_of_scope_cases,
        "audit_events": total_logs,
        "changes_today": updates_today,
        "latest_poll_changes": latest_poll_changes,
        "poll_runs": poll_runs,
        "updated_events": updates,
        "moved_out_events": moved_out_events,
        "moved_in_events": moved_in_events,
        "deleted_events": deleted_events,
        "automation_coverage": {
            "automated_cases": automated_cases,
            "not_automated_cases": not_automated_cases,
            "none_cases": none_cases,
            "manual_cases": manual_cases,
            "automated_pct": automated_pct,
            "not_automated_pct": not_automated_pct,
            "none_pct": none_pct,
            "manual_pct": manual_pct,
            "automated_delta_pct": automated_delta_pct_legacy,
            "manual_delta_pct": manual_delta_pct_legacy,
            "automated_delta_pct_pts": d_automation.get("automated_delta_pct_pts"),
            "manual_delta_pct_pts": d_automation.get("manual_delta_pct_pts"),
            "automated_delta_count": d_automation.get("automated_delta_count"),
            "manual_delta_count": d_automation.get("manual_delta_count"),
            "baseline_at": d_automation.get("baseline_at"),
            "automated_pct_baseline": d_automation.get("automated_pct_baseline"),
            "manual_pct_baseline": d_automation.get("manual_pct_baseline"),
            "total_cases_baseline": d_automation.get("total_cases_baseline"),
            "snapshot_at_iso": latest_snap.recorded_at.isoformat() if latest_snap else None,
            "week_started_iso": week_start_utc.isoformat(),
            "timezone": tz_name,
            "total_cases_delta": d_automation.get("total_cases_delta"),
            "total_cases_delta_pct_pts": d_automation.get("total_cases_delta_pct_pts"),
            "automated_drill_testcases_yes": True,
            "manual_drill_testcases_no": True,
            "automated_audit_action": None,
            "manual_audit_action": None,
            "automated_drill_audit": drill_payload("automation_manual", "ALL"),
            "manual_drill_audit": drill_payload("automation_manual", "ALL"),
        },
        "weekly_activity": weekly_activity,
        "contributors_week": contributors_week,
        "weekly_window": {
            "from_iso": window_start.isoformat(),
            "to_iso": now_utc.isoformat(),
            "timezone": tz_name,
            "period": _period,
            "label": window_label,
        },
    }
