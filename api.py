from contextlib import asynccontextmanager
from datetime import datetime, time, timezone, timedelta
import asyncio
import secrets
from typing import Annotated, List, Any
from collections import defaultdict

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Security, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, func, or_, text, String
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from audit_utils import sanitize_for_storage, diff_changed_fields
from coverage_snapshots import (
    audit_actions_for_metric_key,
    calendar_week_start_utc,
    compute_inventory_counts,
    deltas_vs_baseline,
    ensure_calendar_week_opening_snapshot,
    first_week_snapshot,
    latest_snapshot_in_week,
)
from config import get_settings
from database import AsyncSessionLocal, engine, Base, get_db
from models import AuditLog, TestCaseState, UserDirectory, FolderMap, SyncRun, ReleaseCycle, ChecklistItem
from schemas import (
    AuditLogOut, StatsOut, UserProfile, FolderOut, ConfigOut, ZephyrAuditLog,
    ReleaseCycleCreate, ReleaseCycleOut, ChecklistItemOut, ChecklistItemCreate
)
import uvicorn
import httpx

settings = get_settings()
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_auth = HTTPBearer(auto_error=False)

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, cycle_id: int):
        await websocket.accept()
        self.active_connections[cycle_id].append(websocket)

    def disconnect(self, websocket: WebSocket, cycle_id: int):
        self.active_connections[cycle_id].remove(websocket)

    async def broadcast(self, message: str, cycle_id: int):
        for connection in self.active_connections[cycle_id]:
            await connection.send_text(message)

manager = ConnectionManager()

class RateLimiter:
    def __init__(self, requests_per_minute: int = 60):
        self.requests_per_minute = requests_per_minute
        self.requests: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def is_allowed(self, client_id: str) -> bool:
        async with self._lock:
            now = datetime.now(timezone.utc).timestamp()
            minute_ago = now - 60
            if client_id not in self.requests:
                self.requests[client_id] = []
            self.requests[client_id] = [t for t in self.requests[client_id] if t > minute_ago]
            if len(self.requests[client_id]) >= self.requests_per_minute:
                return False
            self.requests[client_id].append(now)
            return True


rate_limiter = RateLimiter(requests_per_minute=settings.rate_limit_per_minute)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS poll_run_id UUID"))
        await conn.execute(text("ALTER TABLE test_case_state ADD COLUMN IF NOT EXISTS tm4j_id INTEGER"))
        await conn.execute(text("ALTER TABLE sync_run ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'manual'"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_log_poll_run ON audit_log (poll_run_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_test_case_state_tm4j_id ON test_case_state (tm4j_id)"))
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
            RETURNS trigger AS $$
            BEGIN
                IF current_setting('app.allow_audit_log_mutation', true) = 'on' THEN
                    IF TG_OP = 'UPDATE' THEN
                        RETURN NEW;
                    END IF;
                    RETURN OLD;
                END IF;
                IF TG_OP = 'UPDATE'
                   AND NEW.id IS NOT DISTINCT FROM OLD.id
                   AND NEW.zephyr_key IS NOT DISTINCT FROM OLD.zephyr_key
                   AND NEW.project_key IS NOT DISTINCT FROM OLD.project_key
                   AND NEW.action IS NOT DISTINCT FROM OLD.action
                   AND NEW.poll_run_id IS NOT DISTINCT FROM OLD.poll_run_id
                   AND NEW.changed_fields IS NOT DISTINCT FROM OLD.changed_fields
                   AND NEW.diff_before IS NOT DISTINCT FROM OLD.diff_before
                   AND NEW.diff_after IS NOT DISTINCT FROM OLD.diff_after
                   AND NEW.folder_before IS NOT DISTINCT FROM OLD.folder_before
                   AND NEW.folder_after IS NOT DISTINCT FROM OLD.folder_after
                   AND NEW.detected_at IS NOT DISTINCT FROM OLD.detected_at
                THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION 'audit_log is append-only; use the force reset path to clear audit history';
            END;
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text("DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log"))
        await conn.execute(text("""
            CREATE TRIGGER audit_log_append_only
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
        """))
    async with AsyncSessionLocal() as startup_db:
        await ensure_calendar_week_opening_snapshot(startup_db)
    yield
    await engine.dispose()


app = FastAPI(title="Zephyr Audit API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _extract_supplied_key(
    header_key: Annotated[str | None, Security(api_key_header)] = None,
    bearer: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_auth)] = None,
) -> str | None:
    if header_key:
        return header_key
    if bearer:
        return bearer.credentials
    return None


async def require_api_key(supplied_key: Annotated[str | None, Depends(_extract_supplied_key)] = None) -> None:
    try:
        expected_key = settings.require_api_key()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    if not supplied_key or not secrets.compare_digest(supplied_key, expected_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")


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


async def rate_limit_check(request: Request) -> None:
    client_id = request.headers.get("X-API-Key") or request.client.host if request.client else "unknown"
    if not await rate_limiter.is_allowed(client_id):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")


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


# ═══════════════════════════════════════════════════════════════════
# BASIC ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health():
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Database connection failed: {str(e)}")


@app.get("/api/config", response_model=ConfigOut, dependencies=[Depends(require_api_key)])
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


@app.get("/api/stats", response_model=StatsOut, dependencies=[Depends(require_api_key)])
async def get_stats(
    db: AsyncSession = Depends(get_db),
    period: str = Query(default="7d", description="1d|7d|30d|all"),
):
    await ensure_calendar_week_opening_snapshot(db)

    now_utc = datetime.now(timezone.utc)
    week_start_utc = calendar_week_start_utc(now_utc)
    tz_name = getattr(settings, "stats_timezone", "") or ""

    # Resolve the window start/end based on `period`
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
    else:  # "week" — calendar week Monday 00:00
        window_start = week_start_utc
        window_label = "This Calendar Week"

    baseline_snapshot = await first_week_snapshot(db)
    latest_snap = await latest_snapshot_in_week(db, week_start_utc)

    total_cases, automated_cases, not_automated_cases, none_cases = await compute_inventory_counts(db)
    manual_cases = not_automated_cases + none_cases  # backward compat
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


# ═══════════════════════════════════════════════════════════════════
# POLL-WISE GROUPED LOGS FOR LIVE STREAM
# ═══════════════════════════════════════════

class PollGroup(BaseModel):
    poll_id: str
    poll_timestamp: datetime
    folders: dict[str, Any]
    total_changes: int
    actors: list[str]
    actions_summary: dict[str, int]


@app.get("/api/polls", dependencies=[Depends(require_api_key)])
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
    
    # Build a GLOBAL poll number map: the very first SyncRun ever is always #1,
    # regardless of what filters are currently applied. This ensures poll numbers
    # remain stable across filter changes.
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
        # Use stable global number; fall back to position in filtered set if run not in SyncRun
        poll["poll_number"] = global_poll_number.get(poll["poll_id"], None)
    for poll in ordered_polls[offset:offset + limit]:
        for folder in poll["folders"].values():
            folder["actors"] = list(folder["actors"])
            folder["actions"] = dict(folder["actions"])
        poll["actors"] = list(poll["actors"])
        poll["actions_summary"] = dict(poll["actions_summary"])
        polls.append(poll)
    
    return {"items": polls, "total": total_polls, "limit": limit, "offset": offset}


# ═══════════════════════════════════════════════════════════════════
# AUDIT LOGS
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/logs", dependencies=[Depends(require_api_key)])
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

    # Resolve audit_action (sidebar drill semantics) or legacy action param
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


@app.get("/api/logs/{key}/history", response_model=list[AuditLogOut], dependencies=[Depends(require_api_key)])
async def get_test_case_history(key: str, db: AsyncSession = Depends(get_db)):
    """Get audit history for a specific test case. Returns empty array if no history exists."""
    stmt = select(AuditLog).where(AuditLog.zephyr_key == key).order_by(AuditLog.detected_at.desc())
    result = await db.execute(stmt)
    logs = result.scalars().all()
    # Return empty array instead of 404 - test case may exist but have no changes logged yet
    return [_safe_log(log) for log in logs]


# ═══════════════════════════════════════════════════════════════════
# TEST CASES
# ═══════════════════════════════════════════════════════════════════

class TestCaseFullOut(BaseModel):
    id: Any
    zephyr_key: str
    project_key: str
    name: str
    status: str | None
    priority: str | None
    folder_id: int | None
    folder_path: str | None
    owner_account: str | None
    owner_name: str | None
    last_seen_at: datetime
    created_in_db: datetime
    is_deleted: bool
    raw_snapshot: dict | None
    steps_json: list | None

    class Config:
        from_attributes = True


@app.get("/api/testcases", dependencies=[Depends(require_api_key)])
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


@app.get("/api/testcases/{key}", dependencies=[Depends(require_api_key)])
async def get_testcase_detail(key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestCaseState).where(TestCaseState.zephyr_key == key))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail=f"Test case {key} not found")
    return TestCaseFullOut.model_validate(case).model_dump()


@app.get("/api/testcases/{key}/zephyr_history", response_model=List[ZephyrAuditLog], dependencies=[Depends(require_api_key)])
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


# ═══════════════════════════════════════════════════════════════════
# FOLDERS WITH COUNTS
# ═══════════════════════════════════════════════════════════════════

class FolderWithCount(BaseModel):
    folder_id: int
    name: str
    full_path: str
    parent_id: int | None
    tribe: str | None
    test_case_count: int

    class Config:
        from_attributes = True


@app.get("/api/folders", dependencies=[Depends(require_api_key)])
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


@app.get("/api/actors", response_model=list[UserProfile], dependencies=[Depends(require_api_key)])
async def get_actors(db: AsyncSession = Depends(get_db)):
    stmt = select(UserDirectory).order_by(UserDirectory.display_name.asc())
    result = await db.execute(stmt)
    return result.scalars().all()


# ═══════════════════════════════════════════════════════════════════
# DIFF ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/diff", response_model=AuditLogOut, dependencies=[Depends(require_api_key)])
async def get_diff(
    key: str,
    from_timestamp: datetime = Query(..., alias="from"),
    to_timestamp: datetime = Query(..., alias="to"),
    db: AsyncSession = Depends(get_db),
):
    from_state_res = await db.execute(
        select(AuditLog).where(AuditLog.zephyr_key == key, AuditLog.detected_at <= from_timestamp)
        .order_by(AuditLog.detected_at.desc()).limit(1)
    )
    from_state = from_state_res.scalar_one_or_none()
    
    to_state_res = await db.execute(
        select(AuditLog).where(AuditLog.zephyr_key == key, AuditLog.detected_at <= to_timestamp)
        .order_by(AuditLog.detected_at.desc()).limit(1)
    )
    to_state = to_state_res.scalar_one_or_none()
    
    if not to_state:
        raise HTTPException(status_code=404, detail="No state found in window.")
    
    before_snapshot = from_state.diff_after if from_state else {}
    changed_fields = diff_changed_fields(before_snapshot, to_state.diff_after)
    
    return AuditLogOut(
        id=to_state.id,
        zephyr_key=key,
        project_key=to_state.project_key,
        action="DELTA",
        actor_account=to_state.actor_account,
        actor_name=to_state.actor_name,
        changed_fields=changed_fields,
        diff_before=before_snapshot,
        diff_after=to_state.diff_after,
        folder_before=from_state.folder_after if from_state else None,
        folder_after=to_state.folder_after,
        detected_at=to_state.detected_at,
        alerted=False,
        alerted_at=None,
    )


# ═══════════════════════════════════════════════════════════════════
# SYNC ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/sync/run", dependencies=[Depends(require_api_key)])
async def trigger_sync(source: str = Query(default="manual", pattern="^(manual|auto)$"), db: AsyncSession = Depends(get_db)):
    import subprocess
    import sys
    import os

    running_res = await db.execute(
        select(SyncRun).where(SyncRun.status == "running").order_by(SyncRun.started_at.desc()).limit(1)
    )
    running = running_res.scalar_one_or_none()
    if running:
        age = datetime.now(timezone.utc) - running.started_at
        if age < timedelta(minutes=30):
            raise HTTPException(status_code=409, detail="Sync already running.")
        running.status = "failed"
        running.completed_at = datetime.now(timezone.utc)
        running.message = "Marked failed after stale running lock exceeded 30 minutes"
        await db.commit()
    
    poller_path = os.path.join(os.path.dirname(__file__), "poller.py")
    if not os.path.exists(poller_path):
        raise HTTPException(status_code=500, detail="Poller script not found.")
    
    try:
        env = os.environ.copy()
        env["ZEPHYR_SYNC_SOURCE"] = source
        subprocess.Popen([sys.executable, poller_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, env=env)
        return {"status": "success", "message": "Sync triggered."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")


@app.get("/api/sync/status", dependencies=[Depends(require_api_key)])
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(1))
    latest = result.scalar_one_or_none()
    if not latest:
        return {"status": "idle", "running": False}
    return {
        "id": str(latest.id),
        "status": latest.status,
        "source": latest.source,
        "running": latest.status == "running",
        "started_at": latest.started_at,
        "completed_at": latest.completed_at,
        "message": latest.message,
        "total_fetched": latest.total_fetched,
        "total_logged": latest.total_logged,
        "created": latest.created_count,
        "updated": latest.updated_count,
        "moved": latest.moved_count,
        "deleted": latest.deleted_count,
        "unchanged": latest.unchanged_count,
    }


@app.post("/api/sync/reset", dependencies=[Depends(require_api_key)])
async def reset_database_endpoint(db: AsyncSession = Depends(get_db)):
    """Reset all data in the database (test cases, audit logs, folders, users)."""
    try:
        await db.execute(text("SET LOCAL app.allow_audit_log_mutation = 'on'"))
        await db.execute(text(f"TRUNCATE TABLE {AuditLog.__tablename__}, {TestCaseState.__tablename__}, {UserDirectory.__tablename__}, {FolderMap.__tablename__}, {SyncRun.__tablename__} RESTART IDENTITY CASCADE;"))
        await db.commit()
        return {"status": "success", "message": "Database reset complete."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")


@app.post("/api/reset", dependencies=[Depends(require_api_key)])
async def reset_all_data(db: AsyncSession = Depends(get_db)):
    """Alias for /api/sync/reset - Reset all data in the database."""
    try:
        await db.execute(text("SET LOCAL app.allow_audit_log_mutation = 'on'"))
        await db.execute(text(f"TRUNCATE TABLE {AuditLog.__tablename__}, {TestCaseState.__tablename__}, {UserDirectory.__tablename__}, {FolderMap.__tablename__}, {SyncRun.__tablename__} RESTART IDENTITY CASCADE;"))
        await db.commit()
        return {"status": "success", "message": "Database reset complete."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")

# ═══════════════════════════════════════════════════════════════════
# QA CHECKLIST (RELEASE CYCLE) ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/cycles", response_model=ReleaseCycleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_release_cycle(cycle: ReleaseCycleCreate, db: AsyncSession = Depends(get_db)):
    db_cycle = ReleaseCycle(name=cycle.name, status=cycle.status)
    if cycle.test_case_ids:
        # Pre-populate with checklist items
        for tc_id in cycle.test_case_ids:
            item = ChecklistItem(test_case_id=tc_id)
            db_cycle.items.append(item)
    db.add(db_cycle)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A release cycle with name '{cycle.name}' already exists.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"An unexpected database error occurred: {str(e)}")

    await db.refresh(db_cycle)
    # Eagerly load items for the response
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == db_cycle.id)
    )
    return result.scalars().unique().one()

@app.get("/api/cycles", response_model=List[ReleaseCycleOut], dependencies=[Depends(require_api_key)])
async def get_release_cycles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).order_by(ReleaseCycle.created_at.desc()))
    return result.scalars().unique().all()

@app.get("/api/cycles/{cycle_id}", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def get_release_cycle(cycle_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == cycle_id)
    )
    cycle = result.scalars().unique().one_or_none()
    if not cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")
    return cycle

@app.put("/api/cycles/{cycle_id}/items/{item_id}", response_model=ChecklistItemOut, dependencies=[Depends(require_api_key)])
async def update_checklist_item(cycle_id: int, item_id: int, item_update: ChecklistItemCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.release_cycle_id == cycle_id)
    )
    db_item = result.scalar_one_or_none()
    if not db_item:
        raise HTTPException(status_code=404, detail="Checklist item not found")

    update_data = item_update.model_dump(exclude_unset=True)

    # Append to history if status is changing
    if 'status' in update_data and update_data['status'] != db_item.status:
        history_entry = {
            'old_status': db_item.status,
            'new_status': update_data['status'],
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }
        current_history = db_item.history or []
        current_history.append(history_entry)
        db_item.history = current_history

    for key, value in update_data.items():
        setattr(db_item, key, value)

    await db.commit()
    await db.refresh(db_item)

    # Broadcast the update
    await manager.broadcast(f'{{"type": "item_update", "data": {ChecklistItemOut.model_validate(db_item).model_dump_json()}}}', cycle_id)

    return db_item

@app.post("/api/cycles/import_from_zephyr", response_model=ReleaseCycleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def import_from_zephyr(folder_id: int, cycle_name: str, db: AsyncSession = Depends(get_db)):
    # 1. Get the full path of the selected folder
    folder_result = await db.execute(select(FolderMap).where(FolderMap.folder_id == folder_id))
    folder = folder_result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail=f"Folder ID {folder_id} not found in local database.")

    # 2. Find all test cases in this folder OR any sub-folder
    # We use a LIKE query on the folder_path to get the whole hierarchy
    path_prefix = folder.full_path

    test_cases_result = await db.execute(
        select(TestCaseState.id)
        .where(
            TestCaseState.is_deleted == False,
            or_(
                TestCaseState.folder_id == folder_id,
                TestCaseState.folder_path.like(f"{path_prefix} > %")
            )
        )
    )
    test_case_ids = test_cases_result.scalars().all()

    if not test_case_ids:
        raise HTTPException(status_code=404, detail=f"No active test cases found in '{path_prefix}' or its subfolders.")

    # 3. Create a new release cycle with these test cases
    db_cycle = ReleaseCycle(name=cycle_name)
    for tc_id in test_case_ids:
        item = ChecklistItem(test_case_id=tc_id)
        db_cycle.items.append(item)

    db.add(db_cycle)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A release cycle with name '{cycle_name}' already exists.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"An unexpected database error occurred: {str(e)}")

    await db.refresh(db_cycle)

    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == db_cycle.id)
    )
    return result.scalars().unique().one()

@app.websocket("/ws/qa_cycle/{cycle_id}")
async def websocket_endpoint(websocket: WebSocket, cycle_id: int):
    await manager.connect(websocket, cycle_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, cycle_id)

# ═══════════════════════════════════════════════════════════════════
# JIRA INTEGRATION
# ═══════════════════════════════════════════════════════════════════
@app.get("/api/jira/issue/{issue_key}", dependencies=[Depends(require_api_key)])
async def get_jira_issue_status(issue_key: str):
    if not settings.jira_base_url or not settings.jira_api_token or not settings.jira_user_email:
        raise HTTPException(status_code=501, detail="Jira integration not configured.")

    url = f"{settings.jira_base_url}/rest/api/3/issue/{issue_key}?fields=status"
    auth = (settings.jira_user_email, settings.jira_api_token)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, auth=auth)
            response.raise_for_status()
            data = response.json()
            return {"key": issue_key, "status": data['fields']['status']['name']}
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return {"key": issue_key, "status": "Not Found"}
            raise HTTPException(status_code=e.response.status_code, detail=f"Jira API error: {e.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)