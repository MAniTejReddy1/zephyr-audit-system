"""Coverage inventory snapshots for week-over-week deltas (forward-from-first-snapshot semantics)."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import CoverageSnapshot, FolderMap, TestCaseState

_settings = get_settings()


def stats_zoneinfo() -> ZoneInfo:
    name = getattr(_settings, "stats_timezone", None) or "UTC"
    try:
        return ZoneInfo(name.strip() if name else "UTC")
    except Exception:
        return ZoneInfo("UTC")


def calendar_week_start_utc(now_utc: datetime | None = None) -> datetime:
    """Monday 00:00 in STATS_TIMEZONE, returned as timezone-aware UTC."""
    tz = stats_zoneinfo()
    now_local = datetime.now(tz) if now_utc is None else now_utc.astimezone(tz)
    monday = (now_local - timedelta(days=now_local.weekday())).date()
    start_local = datetime.combine(monday, time.min, tzinfo=tz)
    return start_local.astimezone(timezone.utc)


def _yes_automated(value: object) -> bool:
    return str(value or "").strip().lower() in {"yes", "true", "1", "y"}


async def scoped_active_case_conditions(db: AsyncSession) -> list:
    """SQLAlchemy filters for active test cases inside configured parent folder (if any)."""
    conds = [TestCaseState.is_deleted.is_(False)]
    if not _settings.zephyr_parent_folder_id:
        return conds
    parent = await db.get(FolderMap, _settings.zephyr_parent_folder_id)
    if not parent:
        return conds
    parent_path = parent.full_path
    conds.append(
        or_(TestCaseState.folder_path == parent_path, TestCaseState.folder_path.like(f"{parent_path} > %"))
    )
    return conds


def _yes_no_none(custom: dict) -> str:
    """Return 'yes', 'no', or 'none' based on is_automated_in_api/app fields."""
    api_val = str(custom.get("is_automated_in_api") or "").strip().lower()
    app_val = str(custom.get("is_automated_in_app") or "").strip().lower()
    yes_vals = {"yes", "true", "1", "y"}
    no_vals = {"no", "false", "0", "n"}
    if api_val in yes_vals or app_val in yes_vals:
        return "yes"
    if api_val in no_vals or app_val in no_vals:
        return "no"
    return "none"


async def compute_inventory_counts(db: AsyncSession) -> tuple[int, int, int, int]:
    """Returns (total_cases, automated_cases, not_automated_cases, none_cases) for scoped folder."""
    case_filters = await scoped_active_case_conditions(db)
    total_res = await db.execute(select(func.count(TestCaseState.id)).where(*case_filters))
    total_cases = total_res.scalar() or 0
    snaps_res = await db.execute(select(TestCaseState.raw_snapshot).where(*case_filters))
    automated = 0
    not_automated = 0
    none_count = 0
    for (raw,) in snaps_res.all():
        snap = raw or {}
        custom = snap.get("customFields") or {}
        status = _yes_no_none(custom)
        if status == "yes":
            automated += 1
        elif status == "no":
            not_automated += 1
        else:
            none_count += 1
    return total_cases, automated, not_automated, none_count


async def record_inventory_snapshot(db: AsyncSession, commit: bool = True) -> CoverageSnapshot:
    total, automated, not_automated, none_count = await compute_inventory_counts(db)
    manual = not_automated + none_count  # keep legacy field as total non-automated
    snap = CoverageSnapshot(
        recorded_at=datetime.now(timezone.utc),
        total_cases=total,
        automated_cases=automated,
        manual_cases=manual,
        created_count=0,
        moved_in_count=0,
        moved_out_count=0,
        deleted_count=0,
    )
    db.add(snap)
    if commit:
        await db.commit()
        await db.refresh(snap)
    else:
        await db.flush()
    return snap


async def ensure_calendar_week_opening_snapshot(db: AsyncSession) -> None:
    """If no snapshot exists yet for this calendar week, record one (baseline for deltas)."""
    week_start = calendar_week_start_utc()
    existing = await db.execute(
        select(func.count(CoverageSnapshot.id)).where(CoverageSnapshot.recorded_at >= week_start)
    )
    if (existing.scalar() or 0) > 0:
        return
    await record_inventory_snapshot(db, commit=False)
    await db.commit()


async def first_week_snapshot(db: AsyncSession) -> CoverageSnapshot | None:
    week_start = calendar_week_start_utc()
    res = await db.execute(
        select(CoverageSnapshot)
        .where(CoverageSnapshot.recorded_at >= week_start)
        .order_by(CoverageSnapshot.recorded_at.asc())
        .limit(1)
    )
    return res.scalar_one_or_none()


async def latest_snapshot(db: AsyncSession) -> CoverageSnapshot | None:
    q = select(CoverageSnapshot).order_by(CoverageSnapshot.recorded_at.desc()).limit(1)
    res = await db.execute(q)
    row = res.scalar_one_or_none()
    return row


async def latest_snapshot_in_week(db: AsyncSession, week_start: datetime) -> CoverageSnapshot | None:
    res = await db.execute(
        select(CoverageSnapshot)
        .where(CoverageSnapshot.recorded_at >= week_start)
        .order_by(CoverageSnapshot.recorded_at.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


def pct(cases: int, total: int) -> int:
    return round((cases / total) * 100) if total else 0


def deltas_vs_baseline(
    baseline: CoverageSnapshot | None,
    total_cases: int,
    automated_cases: int,
    manual_cases: int,
):
    """Percentage-point and count deltas vs first snapshot of week."""
    if not baseline:
        return {
            "automated_delta_pct_pts": None,
            "manual_delta_pct_pts": None,
            "automated_delta_count": None,
            "manual_delta_count": None,
            "total_cases_delta": None,
            "total_cases_delta_pct_pts": None,
            "baseline_at": None,
            "automated_pct_baseline": None,
            "manual_pct_baseline": None,
            "total_cases_baseline": None,
        }

    bt, ba, bm = baseline.total_cases, baseline.automated_cases, baseline.manual_cases
    bp_auto = pct(ba, bt) if bt else 0
    bp_man = pct(bm, bt) if bt else 0
    cur_auto_pct = pct(automated_cases, total_cases)
    cur_man_pct = pct(manual_cases, total_cases)
    pct_pt_total = round(((total_cases / bt * 100) - 100)) if bt else None
    return {
        "automated_delta_pct_pts": round(cur_auto_pct - bp_auto) if baseline else None,
        "manual_delta_pct_pts": round(cur_man_pct - bp_man) if baseline else None,
        "automated_delta_count": automated_cases - ba,
        "manual_delta_count": manual_cases - bm,
        "total_cases_delta": total_cases - bt,
        "total_cases_delta_pct_pts": pct_pt_total if bt else None,
        "baseline_at": baseline.recorded_at.isoformat(),
        "automated_pct_baseline": bp_auto,
        "manual_pct_baseline": bp_man,
        "total_cases_baseline": bt,
    }


def audit_actions_for_metric_key(key: str) -> Sequence[str]:
    if key == "created":
        return ("CREATED",)
    if key == "moved_in":
        return ("MOVED_IN", "RESTORED")
    if key == "moved_out":
        return ("MOVED",)
    if key == "deleted":
        return ("DELETED",)
    if key == "updated":
        return ("UPDATED",)
    raise ValueError(key)
