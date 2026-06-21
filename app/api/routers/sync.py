import os
import sys
import subprocess
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.db.models import SyncRun, AuditLog, TestCaseState, UserDirectory, FolderMap
from app.api.dependencies import require_api_key

settings = get_settings()

router = APIRouter(prefix="/api", tags=["sync"])


@router.post("/sync/run", dependencies=[Depends(require_api_key)])
async def trigger_sync(source: str = Query(default="manual", pattern="^(manual|auto)$"), db: AsyncSession = Depends(get_db)):
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
    
    # Resolve absolute path to app/services/poller.py
    poller_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "poller.py"))
    if not os.path.exists(poller_path):
        raise HTTPException(status_code=500, detail=f"Poller script not found at {poller_path}.")
    
    try:
        env = os.environ.copy()
        env["ZEPHYR_SYNC_SOURCE"] = source
        subprocess.Popen([sys.executable, poller_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, env=env)
        return {"status": "success", "message": "Sync triggered."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")


@router.get("/sync/status", dependencies=[Depends(require_api_key)])
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


@router.post("/sync/reset", dependencies=[Depends(require_api_key)])
async def reset_database_endpoint(db: AsyncSession = Depends(get_db)):
    """Reset all data in the database (test cases, audit logs, folders, users)."""
    try:
        await db.execute(text("SET LOCAL app.allow_audit_log_mutation = 'on'"))
        await db.execute(text(f"TRUNCATE TABLE {AuditLog.__tablename__}, {TestCaseState.__tablename__}, {UserDirectory.__tablename__}, {FolderMap.__tablename__}, {SyncRun.__tablename__} RESTART IDENTITY CASCADE;"))
        await db.commit()
        return {"status": "success", "message": "Database reset complete."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")


@router.post("/reset", dependencies=[Depends(require_api_key)])
async def reset_all_data(db: AsyncSession = Depends(get_db)):
    """Alias for /api/sync/reset - Reset all data in the database."""
    try:
        await db.execute(text("SET LOCAL app.allow_audit_log_mutation = 'on'"))
        await db.execute(text(f"TRUNCATE TABLE {AuditLog.__tablename__}, {TestCaseState.__tablename__}, {UserDirectory.__tablename__}, {FolderMap.__tablename__}, {SyncRun.__tablename__} RESTART IDENTITY CASCADE;"))
        await db.commit()
        return {"status": "success", "message": "Database reset complete."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")
