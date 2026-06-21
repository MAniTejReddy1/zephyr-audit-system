import asyncio
import base64
import copy
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any
import argparse

import httpx
from sqlalchemy import select, text, func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError

from audit_utils import build_audit_snapshot, diff_changed_fields, extract_user, hash_data, get_meaningful_fields, _is_valid_display_name
from config import get_settings
from database import engine, Base, AsyncSessionLocal
from models import AuditLog, TestCaseState, UserDirectory, FolderMap, SyncRun, CoverageSnapshot
from coverage_snapshots import record_inventory_snapshot

settings = get_settings()
CURRENT_SYNC_RUN_ID = None
logger = logging.getLogger("zephyr_audit.poller")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class ZephyrAPIError(RuntimeError):
    def __init__(self, status_code: int, url: str, body: str):
        super().__init__(f"Zephyr API request failed: {status_code} {url} {body[:500]}")
        self.status_code = status_code


async def init_database_if_needed():
    """Safely creates any missing tables in the database."""
    logger.info("Checking and initializing database tables if missing...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE test_case_state ADD COLUMN IF NOT EXISTS tm4j_id INTEGER"))
        await conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS poll_run_id UUID"))
        await conn.execute(text("ALTER TABLE sync_run ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'manual'"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_test_case_state_tm4j_id ON test_case_state (tm4j_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_log_poll_run ON audit_log (poll_run_id)"))
        await conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS source_event_id VARCHAR"))
        await conn.execute(text("DROP INDEX IF EXISTS uq_audit_source_event"))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_source_event
            ON audit_log (zephyr_key, source_event_id);
        """))
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
            RETURNS trigger AS $$
            BEGIN
                IF current_setting('app.allow_audit_log_mutation', true) = 'on' THEN
                    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
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
    logger.info("Database schema is up to date.")


async def start_sync_run() -> SyncRun | None:
    global CURRENT_SYNC_RUN_ID
    async with AsyncSessionLocal() as db:
        async with db.begin():
            running = await db.execute(
                select(SyncRun).where(SyncRun.status == "running").order_by(SyncRun.started_at.desc()).limit(1)
            )
            active = running.scalar_one_or_none()
            if active:
                age = datetime.now(timezone.utc) - active.started_at
                if age < timedelta(minutes=30):
                    logger.warning("Sync already running since %s; skipping this run", active.started_at)
                    return None
                active.status = "failed"
                active.completed_at = datetime.now(timezone.utc)
                active.message = "Marked failed after stale running lock exceeded 30 minutes"

            source = os.getenv("ZEPHYR_SYNC_SOURCE", "cli").strip().lower()
            if source not in {"manual", "auto", "cli", "backfill"}:
                source = "manual"
            sync_run = SyncRun(status="running", message="Sync started", source=source)
            db.add(sync_run)
            await db.flush()
            CURRENT_SYNC_RUN_ID = sync_run.id
            return sync_run


async def finish_sync_run(sync_run_id, status: str, message: str, stats: dict[str, int] | None = None, total_logged: int = 0) -> None:
    async with AsyncSessionLocal() as db:
        async with db.begin():
            sync_run = await db.get(SyncRun, sync_run_id)
            if not sync_run: return
            stats = stats or {}
            sync_run.status = status
            sync_run.completed_at = datetime.now(timezone.utc)
            sync_run.message = message
            sync_run.total_fetched = stats.get("total_fetched", 0)
            sync_run.created_count = stats.get("new_created", 0)
            sync_run.updated_count = stats.get("updated", 0)
            sync_run.moved_count = stats.get("moved", 0)
            sync_run.deleted_count = stats.get("deleted", 0)
            sync_run.unchanged_count = stats.get("unchanged", 0)
            sync_run.total_logged = total_logged


def _as_int(value: Any) -> int | None:
    try: return int(value) if value is not None else None
    except (TypeError, ValueError): return None

def _entity_name(value: Any, default: str | None = None) -> str | None:
    if isinstance(value, dict): return value.get("name") or value.get("key") or default
    return str(value) if value is not None else default

def _status_key(status_name: Any) -> str:
    return str(status_name or "").strip().lower()

def is_archive_status(status_name: Any) -> bool:
    return _status_key(status_name) in settings.archive_status_names

def is_archive_path(folder_path: str | None) -> bool:
    if not folder_path: return False
    return any(keyword in folder_path.lower() for keyword in ("deprecated", "archived"))

def _snapshot_status_name(snapshot: dict[str, Any] | None) -> str | None:
    if not snapshot: return None
    status = snapshot.get("status")
    return status.get("name") or status.get("id") if isinstance(status, dict) else status

def _with_test_steps(incoming: dict[str, Any], test_steps: list[dict[str, Any]] | None) -> dict[str, Any]:
    snapshot = copy.deepcopy(incoming)
    if test_steps is not None: snapshot["testSteps"] = copy.deepcopy(test_steps)
    return snapshot

def classify_action(
    previous_folder_id: int | None, current_folder_id: int | None, previous_status: str | None, current_status: str | None,
    previous_folder_path: str | None, current_folder_path: str | None, was_deleted: bool,
) -> tuple[str, str | None]:
    archive_keywords = ("deprecated", "archived")
    is_currently_archived = is_archive_status(current_status) or (current_folder_path and any(k in current_folder_path.lower() for k in archive_keywords))
    was_previously_archived = is_archive_status(previous_status) or (previous_folder_path and any(k in previous_folder_path.lower() for k in archive_keywords))
    if is_currently_archived and not was_previously_archived: return "ARCHIVED", None
    if was_previously_archived and not is_currently_archived: return "RESTORED", None
    if was_deleted: return "RESTORED", None
    if previous_folder_id is not None and current_folder_id is not None and previous_folder_id != current_folder_id and not is_currently_archived: return "MOVED", "folder"
    return "UPDATED", None

async def _get_json(client: httpx.AsyncClient, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = await client.get(path, params=params)
    if response.status_code >= 400: raise ZephyrAPIError(response.status_code, str(response.request.url), response.text)
    data = response.json()
    if not isinstance(data, dict): raise RuntimeError(f"Unexpected Zephyr API response for {response.request.url}")
    return data

async def _fetch_paginated_values(client: httpx.AsyncClient, path: str, params: dict[str, Any], max_results_override: int | None = None) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    start_at = 0
    requested_max_results = min(max_results_override or settings.poll_page_size, 1000)
    while True:
        page_params = {**params, "startAt": start_at, "maxResults": requested_max_results}
        data = await _get_json(client, path, page_params)
        page_values = data.get("values") or []
        if not isinstance(page_values, list): raise RuntimeError(f"Unexpected values payload for {path}")
        values.extend(page_values)
        is_last = data.get("isLast")
        if is_last is not None:
            if is_last: break
        else:
            actual_max_results = data.get("maxResults", requested_max_results)
            if not page_values or len(page_values) < actual_max_results: break
        start_at += len(page_values)
    return values

async def fetch_test_cases_by_folders_concurrently(client: httpx.AsyncClient, project_key: str, folder_ids: list[int]) -> list[dict[str, Any]]:
    semaphore = asyncio.Semaphore(settings.folder_fetch_concurrency)
    all_cases = []
    async def _fetch_for_folder(folder_id: int):
        async with semaphore:
            for attempt in range(settings.api_retry_count):
                try:
                    cases = await _fetch_paginated_values(client, "/testcases", {"projectKey": project_key, "folderId": folder_id}, max_results_override=1000)
                    for case in cases:
                        if not case.get("folder"): case["folder"] = {"id": folder_id}
                    return cases
                except (httpx.RequestError, ZephyrAPIError) as e:
                    if attempt == settings.api_retry_count - 1:
                        logger.error(f"Failed to fetch cases for folder {folder_id} after {settings.api_retry_count} attempts: {e}")
                        return []
                    await asyncio.sleep(settings.api_retry_delay_seconds * (attempt + 1))
            return []
    results = await asyncio.gather(*[_fetch_for_folder(fid) for fid in folder_ids])
    for cases_in_folder in results: all_cases.extend(cases_in_folder)
    return all_cases

async def fetch_test_steps_bulk(client: httpx.AsyncClient, test_case_keys: list[str]) -> dict[str, list[dict[str, Any]] | None]:
    if not settings.zephyr_fetch_test_steps or not test_case_keys: return {key: None for key in test_case_keys}
    semaphore = asyncio.Semaphore(settings.test_step_fetch_concurrency)
    async def _fetch_for_key(key: str):
        async with semaphore:
            for attempt in range(settings.api_retry_count):
                try:
                    return key, await _fetch_paginated_values(client, f"/testcases/{key}/teststeps", {}, max_results_override=1000)
                except ZephyrAPIError as exc:
                    if exc.status_code == 404: return key, None
                    if attempt == settings.api_retry_count - 1: return key, None
                except httpx.RequestError:
                    if attempt == settings.api_retry_count - 1: return key, None
                await asyncio.sleep(settings.api_retry_delay_seconds * (attempt + 1))
            return key, None
    results = await asyncio.gather(*[_fetch_for_key(key) for key in test_case_keys])
    return {key: steps for key, steps in results if key is not None}

async def fetch_history_bulk(client: httpx.AsyncClient, test_case_keys: list[str]) -> dict[str, tuple[str | None, str | None]]:
    if not test_case_keys: return {}
    semaphore = asyncio.Semaphore(settings.test_step_fetch_concurrency)
    async def _fetch_history_for_key(key: str) -> tuple[str, tuple[str | None, str | None]]:
        async with semaphore:
            try:
                history = await _fetch_paginated_values(client, f"/testcases/{key}/history", {}, max_results_override=10)
                if history:
                    account, name = _find_actor_in_payload(history[0])
                    if account or name: return key, (account, name)
            except Exception: pass
            return key, (None, None)
    results = await asyncio.gather(*[_fetch_history_for_key(key) for key in test_case_keys])
    return {key: actor for key, actor in results}

TM4J_VERSION_FIELDS = "id,majorVersion,createdBy,createdOn,updatedBy,updatedOn"

def _tm4j_jwt_expiry(jwt: str) -> datetime | None:
    try:
        payload_segment = jwt.split(".")[1]
        payload_segment += "=" * (-len(payload_segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_segment))
        exp = payload.get("exp")
        if exp is not None: return datetime.fromtimestamp(int(exp), tz=timezone.utc)
    except Exception: pass
    return None

def _tm4j_headers() -> dict[str, str]:
    return {"accept": "application/json", "authorization": f"JWT {settings.tm4j_jwt}", "jira-project-id": str(settings.tm4j_jira_project_id), "referer": f"{settings.tm4j_base_url}/"}

def _tm4j_latest_version(versions: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not versions: return None
    return max(versions, key=lambda item: item.get("updatedOn") or item.get("createdOn") or "")

def _tm4j_latest_user_key(history: list[dict[str, Any]]) -> str | None:
    if not history: return None
    for entry in history:
        user_key = entry.get("userKey")
        if isinstance(user_key, str) and user_key.strip(): return user_key.strip()
    return None

async def fetch_tm4j_actors_bulk(test_case_keys: list[str], known_tm4j_ids: dict[str, int | None] | None = None) -> tuple[dict[str, tuple[str | None, str | None]], dict[str, int]]:
    if not test_case_keys or not settings.tm4j_enabled: return {}, {}
    expiry = _tm4j_jwt_expiry(settings.tm4j_jwt or "")
    if expiry and expiry <= datetime.now(timezone.utc):
        logger.warning("TM4J_JWT expired at %s. Copy a fresh JWT from Zephyr UI Network tab into .env", expiry.isoformat())
        return {}, {}
    semaphore = asyncio.Semaphore(settings.tm4j_history_concurrency)
    known_tm4j_ids = known_tm4j_ids or {}
    async def _resolve_version(tm4j_client: httpx.AsyncClient, key: str) -> tuple[int | None, tuple[str | None, str | None]]:
        versions_response = await tm4j_client.get(f"/backend/rest/tests/2.0/testcase/{key}/allVersions", params={"fields": TM4J_VERSION_FIELDS})
        if versions_response.status_code >= 400: return None, (None, None)
        versions = versions_response.json()
        if not isinstance(versions, list): return None, (None, None)
        version = _tm4j_latest_version(versions)
        if not version: return None, (None, None)
        version_id = _as_int(version.get("id"))
        updated_by = version.get("updatedBy")
        return version_id, ((updated_by, None) if updated_by else (None, None))
    async def _fetch_history_actor(tm4j_client: httpx.AsyncClient, tm4j_id: int, fallback_actor: tuple[str | None, str | None]) -> tuple[str | None, str | None]:
        history_response = await tm4j_client.get(f"/backend/rest/tests/2.0/testcase/{tm4j_id}/history")
        if history_response.status_code >= 400: return fallback_actor
        history = history_response.json()
        if isinstance(history, list):
            user_key = _tm4j_latest_user_key(history)
            if user_key: return user_key, None
        return fallback_actor
    async def _fetch_for_key(key: str) -> tuple[str, tuple[str | None, str | None], int | None, bool]:
        async with semaphore:
            try:
                async with httpx.AsyncClient(base_url=settings.tm4j_base_url, headers=_tm4j_headers(), timeout=settings.request_timeout_seconds) as tm4j_client:
                    tm4j_id = _as_int(known_tm4j_ids.get(key))
                    fallback_actor: tuple[str | None, str | None] = (None, None)
                    used_all_versions = False
                    if tm4j_id is None:
                        tm4j_id, fallback_actor = await _resolve_version(tm4j_client, key)
                        used_all_versions = True
                    if tm4j_id is None: return key, fallback_actor, None, used_all_versions
                    actor = await _fetch_history_actor(tm4j_client, tm4j_id, fallback_actor)
                    return key, actor, tm4j_id, used_all_versions
            except Exception: return key, (None, None), None, False
    results = await asyncio.gather(*[_fetch_for_key(key) for key in test_case_keys])
    actors = {key: actor for key, actor, _, _ in results}
    tm4j_ids = {key: tm4j_id for key, _, tm4j_id, _ in results if tm4j_id is not None}
    return actors, tm4j_ids

async def fetch_actors_bulk(zephyr_client: httpx.AsyncClient, test_case_keys: list[str], known_tm4j_ids: dict[str, int | None] | None = None) -> tuple[dict[str, tuple[str | None, str | None]], dict[str, int]]:
    if settings.tm4j_enabled: return await fetch_tm4j_actors_bulk(test_case_keys, known_tm4j_ids)
    return await fetch_history_bulk(zephyr_client, test_case_keys), {}


def _find_actor_in_payload(payload: Any) -> tuple[str | None, str | None]:
    """Robustly extract account ID and display name from any payload."""
    if isinstance(payload, dict):
        # 1. Direct match on current dict
        acc_id = payload.get("accountId") or payload.get("userKey")
        if not acc_id:
            aid = payload.get("id") or payload.get("key")
            if isinstance(aid, str) and not aid.isnumeric() and len(aid) > 10:
                acc_id = aid

        disp_name = payload.get("displayName") or payload.get("name") or payload.get("emailAddress")

        if isinstance(acc_id, str) and not acc_id.isnumeric():
            if isinstance(disp_name, str) and _is_valid_display_name(disp_name):
                return acc_id, disp_name

        # 2. Check known wrapper fields specifically
        for field in ("lastModifiedBy", "updatedBy", "modifiedBy", "changedBy", "user", "actor", "author", "createdBy"):
            val = payload.get(field)
            if isinstance(val, dict):
                a = val.get("accountId") or val.get("userKey") or val.get("id") or val.get("key")
                n = val.get("displayName") or val.get("name") or val.get("emailAddress")
                if isinstance(a, str) and not str(a).isnumeric():
                    if isinstance(n, str) and _is_valid_display_name(n):
                        return a, n
                    return a, None
            elif isinstance(val, str) and not val.isnumeric():
                return val, None

        # 3. Flat string fields
        for field in ("userKey", "accountId", "authorAccountId", "updatedBy", "createdBy"):
            val = payload.get(field)
            if isinstance(val, str) and not val.isnumeric():
                return val, None

        # 4. Deep search
        for value in payload.values():
            if isinstance(value, (dict, list)):
                account, name = _find_actor_in_payload(value)
                if account or name: return account, name

    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, (dict, list)):
                account, name = _find_actor_in_payload(item)
                if account or name: return account, name
    return None, None


async def harvest_users_from_cases(cases: list[dict[str, Any]]):
    """Deeply inspects case payloads to harvest all embedded accountId/displayName pairs, eliminating Jira calls."""
    user_map = {}

    def _extract_and_add(payload: Any):
        if isinstance(payload, dict):
            acc_id = payload.get("accountId") or payload.get("userKey")
            if not acc_id:
                aid = payload.get("id") or payload.get("key")
                if isinstance(aid, str) and not aid.isnumeric() and len(aid) > 10:
                    acc_id = aid

            disp_name = payload.get("displayName") or payload.get("name") or payload.get("emailAddress")

            if acc_id and isinstance(acc_id, str) and not acc_id.isnumeric() and disp_name and isinstance(disp_name, str):
                if _is_valid_display_name(disp_name):
                    user_map[acc_id] = disp_name

            for v in payload.values():
                _extract_and_add(v)
        elif isinstance(payload, list):
            for item in payload:
                _extract_and_add(item)

    for case in cases:
        _extract_and_add(case)

    if user_map:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                for acc_id, disp_name in user_map.items():
                    existing = await db.get(UserDirectory, acc_id)
                    if existing:
                        if existing.display_name != disp_name:
                            existing.display_name = disp_name
                            existing.last_synced = datetime.now(timezone.utc)
                    else:
                        db.add(UserDirectory(account_id=acc_id, display_name=disp_name))
        logger.info(f"Harvested {len(user_map)} user names natively from Zephyr payloads.")


async def fetch_actor_from_history(client: httpx.AsyncClient, test_case_key: str) -> tuple[str | None, str | None]:
    try:
        history = await _fetch_paginated_values(client, f"/testcases/{test_case_key}/history", {}, max_results_override=10)
        if history:
            account, name = _find_actor_in_payload(history[0])
            if account or name: return account, name
    except Exception: pass
    return None, None

async def fetch_actor_from_optional_audit_endpoint(client: httpx.AsyncClient, test_case_key: str) -> tuple[str | None, str | None]:
    if not settings.zephyr_audit_endpoint_template: return None, None
    path = settings.zephyr_audit_endpoint_template.format(testCaseKey=test_case_key, key=test_case_key)
    try:
        payload = await _get_json(client, path)
        return _find_actor_in_payload(payload)
    except Exception: return None, None

async def fetch_jira_display_name(account_id: str) -> str | None:
    if not all([settings.jira_base_url, settings.jira_user_email, settings.jira_api_token]): return None
    async with httpx.AsyncClient(base_url=settings.jira_base_url, auth=(settings.jira_user_email, settings.jira_api_token), timeout=settings.request_timeout_seconds) as client:
        try:
            response = await client.get("/rest/api/3/user", params={"accountId": account_id})
            if response.status_code < 400:
                payload = response.json()
                if isinstance(payload, dict): return payload.get("displayName")
        except httpx.RequestError: pass
    return None

async def resolve_actor_name(db: AsyncSession, account_id: str | None, display_name: str | None = None) -> str | None:
    if _is_valid_display_name(display_name) and account_id:
        cached = await db.get(UserDirectory, account_id)
        if cached:
            if cached.display_name != display_name:
                cached.display_name = display_name
                cached.last_synced = datetime.now(timezone.utc)
        else:
            db.add(UserDirectory(account_id=account_id, display_name=display_name))
        return display_name
    if not account_id: return display_name if _is_valid_display_name(display_name) else None
    cached = await db.get(UserDirectory, account_id)
    if cached and _is_valid_display_name(cached.display_name): return cached.display_name
    try:
        jira_name = await fetch_jira_display_name(account_id)
        if jira_name and _is_valid_display_name(jira_name):
            if cached:
                cached.display_name = jira_name
                cached.last_synced = datetime.now(timezone.utc)
            else:
                db.add(UserDirectory(account_id=account_id, display_name=jira_name))
            return jira_name
    except Exception: pass
    return display_name if _is_valid_display_name(display_name) else None

def _parse_zephyr_timestamp(incoming: dict[str, Any]) -> datetime | None:
    ts_str = incoming.get("updatedOn") or incoming.get("lastModifiedOn")
    if not ts_str: return None
    try:
        if ts_str.endswith('Z'): ts_str = ts_str[:-1] + '+00:00'
        return datetime.fromisoformat(ts_str)
    except (ValueError, TypeError): return None

async def process_test_case(
    db: AsyncSession, incoming: dict[str, Any], folder_id: int | None, folder_path: str, test_steps: list[dict[str, Any]] | None,
    actor: tuple[str | None, str | None], tm4j_id: int | None, poll_run_id, seen_at: datetime, is_genesis_run: bool, prev_state: TestCaseState | None,
) -> bool:
    key = incoming.get("key")
    if not key: return False
    current_raw_snapshot = _with_test_steps(incoming, test_steps)
    current_audit_snapshot = build_audit_snapshot(incoming, folder_path, test_steps)
    current_hash = hash_data(current_audit_snapshot)
    status_name = _entity_name(incoming.get("status"), "Unknown")
    priority_name = _entity_name(incoming.get("priority"))
    owner_account, owner_name = extract_user(incoming, "owner")
    actor_account, actor_name_hint = actor
    resolved_owner_name = await resolve_actor_name(db, owner_account, owner_name)
    resolved_actor_name = await resolve_actor_name(db, actor_account, actor_name_hint)
    zephyr_timestamp = _parse_zephyr_timestamp(incoming) or seen_at

    insert_stmt = pg_insert(TestCaseState).values(
        zephyr_key=key,
        project_key=settings.zephyr_project_key,
        name=incoming.get("name", "Unknown"),
        status=status_name,
        priority=priority_name,
        folder_id=folder_id,
        folder_path=folder_path,
        owner_account=owner_account,
        owner_name=resolved_owner_name,
        tm4j_id=tm4j_id,
        steps_hash=current_hash,
        steps_json=test_steps,
        raw_snapshot=current_raw_snapshot,
        last_seen_at=seen_at,
        is_deleted=False,
    )
    on_conflict_stmt = insert_stmt.on_conflict_do_update(
        index_elements=['zephyr_key'],
        set_={
            "name": insert_stmt.excluded.name,
            "status": insert_stmt.excluded.status,
            "priority": insert_stmt.excluded.priority,
            "folder_id": insert_stmt.excluded.folder_id,
            "folder_path": insert_stmt.excluded.folder_path,
            "owner_account": insert_stmt.excluded.owner_account,
            "owner_name": insert_stmt.excluded.owner_name,
            "tm4j_id": insert_stmt.excluded.tm4j_id,
            "steps_hash": insert_stmt.excluded.steps_hash,
            "steps_json": insert_stmt.excluded.steps_json,
            "raw_snapshot": insert_stmt.excluded.raw_snapshot,
            "last_seen_at": insert_stmt.excluded.last_seen_at,
            "is_deleted": False
        }
    )
    await db.execute(on_conflict_stmt)

    if not prev_state:
        if not is_genesis_run:
            db.add(AuditLog(
                zephyr_key=key, project_key=settings.zephyr_project_key, action="CREATED", changed_fields=diff_changed_fields(None, current_audit_snapshot),
                diff_before={}, diff_after=current_raw_snapshot, folder_before=None, folder_after=folder_path, actor_account=actor_account,
                actor_name=resolved_actor_name, poll_run_id=poll_run_id, detected_at=_parse_iso(incoming.get("createdOn")) or zephyr_timestamp,
            ))
            return True
        return False

    if not prev_state.raw_snapshot:
        return False

    diff_before = prev_state.raw_snapshot or {}
    previous_folder_id = prev_state.folder_id
    previous_folder_path = prev_state.folder_path
    previous_steps = prev_state.steps_json or (diff_before.get("testSteps") if diff_before else None)
    previous_audit_snapshot = build_audit_snapshot(diff_before, previous_folder_path, previous_steps)
    previous_hash = hash_data(previous_audit_snapshot)
    previous_status_name = _snapshot_status_name(previous_audit_snapshot)
    was_deleted = prev_state.is_deleted

    has_content_changed = current_hash != previous_hash
    has_folder_id_changed = (previous_folder_id is not None and folder_id is not None and previous_folder_id != folder_id)
    has_folder_path_changed = (previous_folder_path is not None and folder_path is not None and previous_folder_path != folder_path)
    has_location_changed = has_folder_id_changed or has_folder_path_changed
    action, reason = classify_action(previous_folder_id, folder_id, previous_status_name, status_name, previous_folder_path, folder_path, was_deleted)
    if has_location_changed and not was_deleted: action = "MOVED"

    if action != "UPDATED" or has_content_changed or has_location_changed:
        changed_fields = diff_changed_fields(get_meaningful_fields(previous_audit_snapshot), get_meaningful_fields(current_audit_snapshot))
        if has_location_changed and "folderPath" not in changed_fields: changed_fields.append("folderPath")
        folder_before, folder_after = (previous_folder_path, folder_path) if action in {"MOVED", "MOVED_IN", "DELETED", "RESTORED"} and ("folderPath" in changed_fields or has_location_changed) else (None, folder_path)
        db.add(AuditLog(
            zephyr_key=key, project_key=settings.zephyr_project_key, action=action, changed_fields=changed_fields, diff_before=diff_before,
            diff_after=current_raw_snapshot, folder_before=folder_before, folder_after=folder_after, actor_account=actor_account,
            actor_name=resolved_actor_name, poll_run_id=poll_run_id, detected_at=zephyr_timestamp,
        ))
        return True

    return False

def build_folder_helpers(folders: list[dict[str, Any]]):
    folder_by_id = {_as_int(folder.get("id")): folder for folder in folders if _as_int(folder.get("id")) is not None}
    def is_descendant(folder_id: int, target_parent_id: int) -> bool:
        visited, current = set(), folder_by_id.get(folder_id)
        while current:
            current_id = _as_int(current.get("id"))
            if current_id in visited: return False
            visited.add(current_id)
            parent_id = _as_int(current.get("parentId"))
            if parent_id == target_parent_id: return True
            current = folder_by_id.get(parent_id)
        return False
    def folder_path(folder_id: int) -> str:
        names, visited = [], set()
        current = folder_by_id.get(folder_id)
        while current:
            current_id = _as_int(current.get("id"))
            if current_id in visited: break
            visited.add(current_id)
            names.append(current.get("name") or f"Folder {current_id}")
            current = folder_by_id.get(_as_int(current.get("parentId")))
        return " > ".join(reversed(names)) if names else f"Folder {folder_id}"
    return folder_by_id, is_descendant, folder_path

async def sync_folder_map(db: AsyncSession, folders: list[dict[str, Any]], folder_path_for_id) -> None:
    for folder in folders:
        folder_id = _as_int(folder.get("id"))
        if folder_id is None: continue
        existing = await db.get(FolderMap, folder_id)
        path = folder_path_for_id(folder_id)
        if existing:
            existing.project_key, existing.name, existing.parent_id, existing.full_path, existing.synced_at = settings.zephyr_project_key, folder.get("name") or f"Folder {folder_id}", _as_int(folder.get("parentId")), path, datetime.now(timezone.utc)
        else:
            db.add(FolderMap(folder_id=folder_id, project_key=settings.zephyr_project_key, name=folder.get("name") or f"Folder {folder_id}", parent_id=_as_int(folder.get("parentId")), full_path=path))

async def mark_missing_cases_as_deleted(db: AsyncSession, seen_keys: set[str], all_project_cases_by_key: dict[str, dict[str, Any]], folder_path_for_id, history_by_key: dict[str, tuple[str | None, str | None]], poll_run_id, seen_at: datetime) -> int:
    result = await db.execute(select(TestCaseState).where(TestCaseState.project_key == settings.zephyr_project_key, TestCaseState.is_deleted.is_(False)))
    all_db_cases = result.scalars().all()
    deleted_count = 0
    for state in all_db_cases:
        if state.zephyr_key in seen_keys: continue
        previous_snapshot = state.raw_snapshot or {}
        actor_account, actor_name_hint = history_by_key.get(state.zephyr_key, (None, None))
        if not actor_account and not actor_name_hint: actor_account, actor_name_hint = _find_actor_in_payload(previous_snapshot)
        resolved_actor_name = await resolve_actor_name(db, actor_account, actor_name_hint)
        current_case = all_project_cases_by_key.get(state.zephyr_key)
        current_folder_path, action, changed_fields = None, "DELETED", ["is_deleted"]
        current_snapshot = {"status": {"name": "Deleted"}, "is_deleted": True}
        if current_case:
            folder_obj = current_case.get("folder")
            current_folder_id = _as_int(folder_obj.get("id") if isinstance(folder_obj, dict) else current_case.get("folderId"))
            current_folder_path = folder_path_for_id(current_folder_id) if current_folder_id else None
            current_snapshot = build_audit_snapshot(current_case, current_folder_path, None)
            changed_fields = diff_changed_fields(get_meaningful_fields(build_audit_snapshot(previous_snapshot, state.folder_path, state.steps_json)), get_meaningful_fields(current_snapshot))
            if "folderPath" not in changed_fields: changed_fields.append("folderPath")
            action = "DELETED" if is_archive_path(current_folder_path) or is_archive_status(_entity_name(current_case.get("status"))) else "MOVED"
        state.is_deleted, state.last_seen_at = True, seen_at
        db.add(AuditLog(
            zephyr_key=state.zephyr_key, project_key=settings.zephyr_project_key, action=action, changed_fields=changed_fields, diff_before=previous_snapshot,
            diff_after=current_snapshot, folder_before=state.folder_path, folder_after=current_folder_path, actor_account=actor_account,
            actor_name=resolved_actor_name, poll_run_id=poll_run_id, detected_at=seen_at,
        ))
        deleted_count += 1
    return deleted_count

async def clear_database():
    logger.info("Initiating database purge...")
    async with AsyncSessionLocal() as db:
        try:
            await db.execute(text("SET LOCAL app.allow_audit_log_mutation = 'on'"))
            await db.execute(text(f"TRUNCATE TABLE {AuditLog.__tablename__}, {TestCaseState.__tablename__}, {UserDirectory.__tablename__}, {FolderMap.__tablename__}, {SyncRun.__tablename__}, {CoverageSnapshot.__tablename__} RESTART IDENTITY CASCADE;"))
            await db.commit()
            logger.info("Database purge complete.")
        except Exception as e:
            logger.error(f"Error during purge: {e}")
            await db.rollback()

def _parse_iso(ts_str: str | None) -> datetime | None:
    if not ts_str: return None
    try:
        if ts_str.endswith('Z'): ts_str = ts_str[:-1] + '+00:00'
        return datetime.fromisoformat(ts_str)
    except (ValueError, TypeError): return None

async def _insert_backfill(db: AsyncSession, key: str, action: str, detected_at: datetime, actor: tuple[str | None, str | None], source_event_id: str, poll_run_id, diff_after: dict | None = None, diff_before: dict | None = None, folder_after: str | None = None, changed_fields: list[str] | None = None):
    actor_account, actor_name_hint = actor
    insert_stmt = pg_insert(AuditLog).values(
        zephyr_key=key, project_key=settings.zephyr_project_key, action=action, detected_at=detected_at,
        actor_account=actor_account, actor_name=actor_name_hint, diff_before=diff_before or {}, diff_after=diff_after or {},
        folder_before=None, folder_after=folder_after, changed_fields=changed_fields or [],
        source_event_id=source_event_id, poll_run_id=poll_run_id,
    )
    on_conflict_stmt = insert_stmt.on_conflict_do_nothing(index_elements=['zephyr_key', 'source_event_id'])
    await db.execute(on_conflict_stmt)

def map_tm4j_property(prop: str) -> str:
    prop = prop.strip()
    mapping = {
        'name': 'name',
        'status': 'status',
        'priority': 'priority',
        'folder': 'folderPath',
        'folder id': 'folderPath',
        'folderpath': 'folderPath',
        'estimated time': 'estimatedTime',
        'objective': 'objective',
        'precondition': 'precondition',
        'labels': 'labels',
        'component': 'component'
    }
    return mapping.get(prop, prop)

async def update_audit_log_actor_names(db: AsyncSession):
    resolved_users = await db.execute(select(UserDirectory))
    user_map = {u.account_id: u.display_name for u in resolved_users.scalars().all() if _is_valid_display_name(u.display_name)}
    if not user_map: return
    logs_to_update_res = await db.execute(
        select(AuditLog).where(
            AuditLog.actor_account.in_(user_map.keys()),
            or_(AuditLog.actor_name.is_(None), AuditLog.actor_name == AuditLog.actor_account)
        )
    )
    logs_to_update = logs_to_update_res.scalars().all()
    for log in logs_to_update:
        resolved_name = user_map.get(log.actor_account)
        if resolved_name and log.actor_name != resolved_name: log.actor_name = resolved_name

async def perform_historical_backfill(client, run_id, all_cases, steps_by_key, folder_path_for_id, known_tm4j_ids):
    total_created = 0
    total_historical_events = 0
    name_by_key = {c["key"]: c.get("name", "Unknown") for c in all_cases if c.get("key")}
    global_user_map = {}

    # Phase 1: Creation events
    async with AsyncSessionLocal() as db:
        async with db.begin():
            for case in all_cases:
                key = case.get("key")
                if not key: continue
                folder_id = _as_int((case.get("folder") or {}).get("id"))
                folder_path = folder_path_for_id(folder_id) if folder_id else "Unknown"
                created_on = _parse_iso(case.get("createdOn"))
                if not created_on: continue
                actor_account, actor_name_hint = extract_user(case, "createdBy", "owner")

                if actor_account and actor_name_hint and _is_valid_display_name(actor_name_hint):
                    global_user_map[actor_account] = actor_name_hint

                test_steps = steps_by_key.get(key)
                snapshot = build_audit_snapshot(case, folder_path, test_steps)

                await _insert_backfill(
                    db=db, key=key, action="CREATED", detected_at=created_on, actor=(actor_account, actor_name_hint),
                    source_event_id=f"created:{key}", poll_run_id=run_id, diff_after=snapshot, folder_after=folder_path,
                    changed_fields=list(get_meaningful_fields(snapshot).keys())
                )
                total_created += 1

    logger.info(f"Phase 1 Complete: Inserted {total_created} CREATED events.")

    # Phase 2: Detailed History
    keys = [c.get("key") for c in all_cases if c.get("key")]
    semaphore = asyncio.Semaphore(settings.tm4j_history_concurrency)

    async def process_history_key(key: str, db_session: AsyncSession):
        nonlocal total_historical_events
        async with semaphore:
            try:
                history_entries = []
                if settings.tm4j_enabled:
                    async with httpx.AsyncClient(base_url=settings.tm4j_base_url, headers=_tm4j_headers(), timeout=settings.request_timeout_seconds) as tm4j_client:
                        tm4j_id = known_tm4j_ids.get(key)
                        if not tm4j_id:
                            versions_res = await tm4j_client.get(f"/backend/rest/tests/2.0/testcase/{key}/allVersions", params={"fields": "id"})
                            if versions_res.status_code < 400:
                                versions = versions_res.json()
                                if isinstance(versions, list) and versions: tm4j_id = max(versions, key=lambda v: v.get('id', 0)).get('id')
                        if tm4j_id:
                            hist_res = await tm4j_client.get(f"/backend/rest/tests/2.0/testcase/{tm4j_id}/history")
                            if hist_res.status_code < 400 and isinstance(hist_res.json(), list): history_entries = hist_res.json()

                if not history_entries:
                    history_entries = await _fetch_paginated_values(client, f"/testcases/{key}/history", {}, max_results_override=100)

                for entry in history_entries:
                    ev_id = str(entry.get('id') or entry.get('timestamp') or '')
                    if not ev_id: continue
                    ts_val = entry.get('actionDate') or entry.get('timestamp') or entry.get('createdOn') or entry.get('date')
                    ts = None
                    if isinstance(ts_val, (int, float)): ts = datetime.fromtimestamp(ts_val / 1000.0, tz=timezone.utc)
                    elif isinstance(ts_val, str): ts = _parse_iso(ts_val)
                    if not ts: continue

                    actor_account, actor_name = _find_actor_in_payload(entry)
                    if 'userKey' in entry and not actor_account: actor_account = entry['userKey']

                    if actor_account and actor_name and _is_valid_display_name(actor_name):
                        global_user_map[actor_account] = actor_name

                    prop_raw = str(entry.get('property') or entry.get('field') or '').lower()
                    prop = map_tm4j_property(prop_raw)
                    old_val = entry.get('oldValue') or entry.get('from') or ''
                    new_val = entry.get('newValue') or entry.get('to') or ''

                    diff_before = {prop: old_val} if prop else {}
                    diff_after = {"name": name_by_key.get(key, "Unknown")}
                    if prop: diff_after[prop] = new_val

                    action = 'UPDATED'
                    if prop == 'folderPath': action = 'MOVED'
                    elif prop == 'status' and str(new_val).lower() in settings.archive_status_names: action = 'ARCHIVED'

                    await _insert_backfill(
                        db_session, key, action, ts, (actor_account, actor_name), f"hist:{key}:{ev_id}", run_id,
                        diff_before=diff_before, diff_after=diff_after, changed_fields=[prop] if prop else []
                    )
                    total_historical_events += 1
            except Exception as e:
                logger.warning(f"Could not process history for {key}: {e}")

    async with AsyncSessionLocal() as db:
        async with db.begin():
            chunk_size = 200
            for i in range(0, len(keys), chunk_size):
                chunk = keys[i:i+chunk_size]
                logger.info(f"Processing history chunk {i//chunk_size + 1}/{(len(keys) + chunk_size - 1) // chunk_size}...")
                await asyncio.gather(*[process_history_key(k, db) for k in chunk])

    if global_user_map:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                for acc_id, disp_name in global_user_map.items():
                    existing = await db.get(UserDirectory, acc_id)
                    if existing:
                        if existing.display_name != disp_name:
                            existing.display_name = disp_name
                            existing.last_synced = datetime.now(timezone.utc)
                    else:
                        db.add(UserDirectory(account_id=acc_id, display_name=disp_name))
        logger.info(f"Harvested {len(global_user_map)} user names from history entries.")

    return total_created, total_historical_events


async def auto_heal_missing_actors(db: AsyncSession):
    """Retroactively fixes AuditLog entries that are missing actor_account by falling back to the current owner."""
    # Find logs with missing actor
    logs_res = await db.execute(
        select(AuditLog).where(AuditLog.actor_account.is_(None), AuditLog.action == "CREATED")
    )
    logs = logs_res.scalars().all()
    if not logs:
        return

    # Get all states to use owner as fallback
    states_res = await db.execute(select(TestCaseState.zephyr_key, TestCaseState.owner_account, TestCaseState.owner_name))
    states_map = {row.zephyr_key: (row.owner_account, row.owner_name) for row in states_res.all()}

    fixed_count = 0
    for log in logs:
        if log.zephyr_key in states_map:
            acc, name = states_map[log.zephyr_key]
            if acc:
                log.actor_account = acc
                log.actor_name = name
                fixed_count += 1

    if fixed_count > 0:
        logger.info(f"Auto-healed {fixed_count} audit logs with missing actor accounts.")


async def run_recursive_sync():
    await init_database_if_needed()
    settings.require_zephyr_config()

    async with AsyncSessionLocal() as db:
        await auto_heal_missing_actors(db)
        await db.commit()

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(func.count(TestCaseState.id)))
        is_genesis_run = (res.scalar() or 0) == 0

    if is_genesis_run:
        logger.info("Genesis run detected. Automatically triggering full historical backfill...")
        os.environ["ZEPHYR_SYNC_SOURCE"] = "backfill"

    sync_run = await start_sync_run()
    if not sync_run: return
    logger.info("Starting Zephyr audit sync for project %s", settings.zephyr_project_key)

    headers = {"Authorization": f"Bearer {settings.zephyr_api_token}", "Content-Type": "application/json"}
    transport = httpx.AsyncHTTPTransport(retries=3)

    async with httpx.AsyncClient(base_url=settings.zephyr_base_url, headers=headers, timeout=settings.request_timeout_seconds, transport=transport) as client:
        folders = await _fetch_paginated_values(client, "/folders", {"projectKey": settings.zephyr_project_key}, max_results_override=200)
        folder_by_id, is_descendant, folder_path_for_id = build_folder_helpers(folders)
        parent_id = settings.zephyr_parent_folder_id
        if parent_id not in folder_by_id: raise RuntimeError(f"Configured ZEPHYR_PARENT_FOLDER_ID {parent_id} was not found")
        target_folder_ids = [parent_id, *[f for f in folder_by_id if f is not None and is_descendant(f, parent_id)]]

        async with AsyncSessionLocal() as db:
            async with db.begin():
                await sync_folder_map(db, folders, folder_path_for_id)

        all_cases = await fetch_test_cases_by_folders_concurrently(client, settings.zephyr_project_key, target_folder_ids)

        # Aggressively harvest user names from all payloads to bypass Jira API where possible
        await harvest_users_from_cases(all_cases)

        all_project_cases_by_key = {case.get("key"): case for case in all_cases if case.get("key")}

        existing_snapshots, existing_steps, existing_tm4j_ids, existing_hashes, existing_folder_ids, existing_folder_paths, existing_is_deleted = {}, {}, {}, {}, {}, {}, {}
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TestCaseState).where(TestCaseState.project_key == settings.zephyr_project_key))
            for row in res.scalars().all():
                existing_snapshots[row.zephyr_key] = row.raw_snapshot
                existing_steps[row.zephyr_key] = row.steps_json
                existing_tm4j_ids[row.zephyr_key] = row.tm4j_id
                existing_hashes[row.zephyr_key] = row.steps_hash
                existing_folder_ids[row.zephyr_key] = row.folder_id
                existing_folder_paths[row.zephyr_key] = row.folder_path
                existing_is_deleted[row.zephyr_key] = row.is_deleted

        keys_needing_steps = []
        for case in all_cases:
            key = case.get("key")
            if not key: continue
            prev_snapshot = existing_snapshots.get(key)
            if prev_snapshot:
                folder_obj = case.get("folder")
                curr_folder_id = _as_int(folder_obj.get("id") if isinstance(folder_obj, dict) else case.get("folderId"))
                prev_folder_id = _as_int((prev_snapshot.get("folder") or {}).get("id"))
                if (prev_folder_id is not None and curr_folder_id is not None and prev_folder_id != curr_folder_id) or (existing_folder_paths.get(key) != folder_path_for_id(curr_folder_id)):
                    keys_needing_steps.append(key)
                elif (prev_snapshot.get("updatedOn") or prev_snapshot.get("lastModifiedOn")) != (case.get("updatedOn") or case.get("lastModifiedOn")):
                    keys_needing_steps.append(key)
            else:
                keys_needing_steps.append(key)

        steps_by_key = await fetch_test_steps_bulk(client, keys_needing_steps)
        all_keys = [case.get("key") for case in all_cases if case.get("key")]
        missing_keys = sorted(key for key in set(existing_snapshots) - set(all_keys) if not existing_is_deleted.get(key))
        if missing_keys:
            project_cases = await _fetch_paginated_values(client, "/testcases", {"projectKey": settings.zephyr_project_key}, max_results_override=1000)
            all_project_cases_by_key.update({case.get("key"): case for case in project_cases if case.get("key")})

        candidate_history_keys = set(missing_keys)
        for case in all_cases:
            key = case.get("key")
            if not key: continue
            folder_id = _as_int((case.get("folder") or {}).get("id"))
            folder_path = folder_path_for_id(folder_id) if folder_id else "Unknown"
            if key not in existing_snapshots or existing_folder_ids.get(key) != folder_id or existing_folder_paths.get(key) != folder_path:
                candidate_history_keys.add(key)
                continue
            test_steps = steps_by_key.get(key) or existing_steps.get(key)
            current_hash = hash_data(build_audit_snapshot(case, folder_path, test_steps))
            if existing_hashes.get(key) != current_hash:
                candidate_history_keys.add(key)

        history_by_key, tm4j_ids_by_key = await fetch_actors_bulk(client, sorted(candidate_history_keys), existing_tm4j_ids)

        stats = {'total_fetched': len(all_cases), 'previously_tracked': len(existing_snapshots), 'new_created': 0, 'updated': 0, 'moved': 0, 'deleted': 0, 'unchanged': 0}
        total_logged, seen_keys, seen_at = 0, set(), datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            async with db.begin():
                res = await db.execute(select(TestCaseState).where(TestCaseState.project_key == settings.zephyr_project_key))
                existing_states = {s.zephyr_key: s for s in res.scalars().all()}
                for case in all_cases:
                    key = case.get("key")
                    if key: seen_keys.add(key)
                    folder_id = _as_int((case.get("folder") or {}).get("id"))
                    folder_path = folder_path_for_id(folder_id) if folder_id else "Unknown"
                    test_steps = steps_by_key.get(key) or existing_steps.get(key)
                    actor_account, actor_name = history_by_key.get(key, (None, None))
                    if not actor_account and not actor_name:
                        actor_account, actor_name = extract_user(case, "createdBy", "owner", "author")
                    if not actor_account and not actor_name:
                        actor_account, actor_name = _find_actor_in_payload(case)
                    if not actor_account and not actor_name and key:
                        actor_account, actor_name = await fetch_actor_from_optional_audit_endpoint(client, key)
                    prev_state = existing_states.get(key)

                    changed = await process_test_case(db, case, folder_id, folder_path, test_steps, (actor_account, actor_name), tm4j_ids_by_key.get(key) or existing_tm4j_ids.get(key), sync_run.id, seen_at, is_genesis_run, prev_state)

                    if changed:
                        total_logged += 1
                        if prev_state is None: stats['new_created'] += 1
                        elif prev_state.folder_id != folder_id: stats['moved'] += 1
                        else: stats['updated'] += 1
                    else:
                        stats['unchanged'] += 1

                deleted_total = await mark_missing_cases_as_deleted(db, seen_keys, all_project_cases_by_key, folder_path_for_id, history_by_key, sync_run.id, seen_at)
                stats['deleted'] = deleted_total
                if deleted_total > 0: total_logged += deleted_total

        if is_genesis_run:
            # We fetch tm4j_ids fresh from the DB to pass to perform_historical_backfill
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(TestCaseState.zephyr_key, TestCaseState.tm4j_id).where(TestCaseState.project_key == settings.zephyr_project_key))
                all_tm4j_ids = {row.zephyr_key: row.tm4j_id for row in res.all()}

            logger.info("Performing detailed historical backfill for Audit Logs...")
            total_created, total_hist = await perform_historical_backfill(client, sync_run.id, all_cases, steps_by_key, folder_path_for_id, all_tm4j_ids)
            total_logged += total_created + total_hist
            stats['new_created'] = total_created
            stats['updated'] = total_hist
            stats['unchanged'] = 0

    # Ensure Jira names are fetched for ALL missing accounts
    await update_user_names_from_jira()

    # One final pass to update audit logs with the newly fetched jira names
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await update_audit_log_actor_names(db)

    await finish_sync_run(sync_run.id, "completed", "Sync complete" + (" (incl. backfill)" if is_genesis_run else ""), stats, total_logged)
    try:
        async with AsyncSessionLocal() as snap_db: await record_inventory_snapshot(snap_db, commit=True)
    except Exception: pass


async def update_user_names_from_jira():
    if not all([settings.jira_base_url, settings.jira_user_email, settings.jira_api_token]): return

    async with AsyncSessionLocal() as db:
        # 1. Update existing bad names
        res = await db.execute(select(UserDirectory).where(UserDirectory.display_name.like('%:%') | (func.length(UserDirectory.display_name) == 24)))
        users_to_update = res.scalars().all()

        # 2. Find missing accounts from AuditLog and TestCaseState
        unresolved_logs = await db.execute(select(AuditLog.actor_account).where(AuditLog.actor_account.isnot(None), AuditLog.actor_account.notin_(select(UserDirectory.account_id))).distinct())
        missing_accounts = unresolved_logs.scalars().all()

        unresolved_states = await db.execute(select(TestCaseState.owner_account).where(TestCaseState.owner_account.isnot(None), TestCaseState.owner_account.notin_(select(UserDirectory.account_id))).distinct())
        missing_accounts.extend(unresolved_states.scalars().all())

        missing_accounts = list(set(missing_accounts))

        logger.info(f"Fetching Jira names for {len(missing_accounts)} missing accounts and {len(users_to_update)} bad names...")

        for account_id in missing_accounts:
            try:
                jira_name = await fetch_jira_display_name(account_id)
                if jira_name and _is_valid_display_name(jira_name):
                    db.add(UserDirectory(account_id=account_id, display_name=jira_name))
            except Exception: pass

        for user in users_to_update:
            try:
                jira_name = await fetch_jira_display_name(user.account_id)
                if jira_name and _is_valid_display_name(jira_name): user.display_name = jira_name
            except Exception: pass

        await db.commit()

        async with AsyncSessionLocal() as db2:
            res = await db2.execute(select(UserDirectory))
            user_map = {u.account_id: u.display_name for u in res.scalars().all() if _is_valid_display_name(u.display_name)}
            if not user_map: return
            res = await db2.execute(select(TestCaseState).where(TestCaseState.owner_account.in_(user_map.keys())))
            for case in res.scalars().all():
                resolved_name = user_map.get(case.owner_account)
                if resolved_name and case.owner_name != resolved_name: case.owner_name = resolved_name
            await db2.commit()

async def backfill_tm4j_audit_actors():
    if not settings.tm4j_enabled: return
    await init_database_if_needed()
    async with AsyncSessionLocal() as db:
        logs = (await db.execute(select(AuditLog).where(AuditLog.actor_account.is_(None) | AuditLog.actor_name.is_(None)))).scalars().all()
        states = (await db.execute(select(TestCaseState.zephyr_key, TestCaseState.tm4j_id).where(TestCaseState.project_key == settings.zephyr_project_key))).all()
        known_tm4j_ids = {row.zephyr_key: row.tm4j_id for row in states}
    if not logs: return
    keys = sorted({log.zephyr_key for log in logs if log.zephyr_key})
    actors, tm4j_ids = await fetch_tm4j_actors_bulk(keys, known_tm4j_ids)
    async with AsyncSessionLocal() as db:
        async with db.begin():
            if tm4j_ids:
                states = (await db.execute(select(TestCaseState).where(TestCaseState.zephyr_key.in_(tm4j_ids.keys())))).scalars().all()
                for state in states: state.tm4j_id = tm4j_ids.get(state.zephyr_key) or state.tm4j_id
            logs = (await db.execute(select(AuditLog).where(AuditLog.actor_account.is_(None) | AuditLog.actor_name.is_(None)))).scalars().all()
            for log in logs:
                account, hint = actors.get(log.zephyr_key, (None, None))
                if not account: continue
                log.actor_account = account
                log.actor_name = await resolve_actor_name(db, account, hint)

async def run_recursive_sync_with_status():
    try:
        await run_recursive_sync()
    except Exception as exc:
        logger.error(f"Sync failed: {exc}", exc_info=True)
        if CURRENT_SYNC_RUN_ID:
            await finish_sync_run(CURRENT_SYNC_RUN_ID, "failed", str(exc), {}, 0)
        raise

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Zephyr Audit System Poller")
    parser.add_argument("--reset", action="store_true", help="Purge all data from the database tables.")
    parser.add_argument("--backfill-actors", action="store_true", help="Backfill audit_log actor fields from TM4J history (requires TM4J_JWT).")
    args = parser.parse_args()
    if args.reset: asyncio.run(clear_database())
    elif args.backfill_actors: asyncio.run(backfill_tm4j_audit_actors())
    else: asyncio.run(run_recursive_sync_with_status())