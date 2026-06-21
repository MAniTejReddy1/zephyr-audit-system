import asyncio
import logging
import httpx
from sqlalchemy import select
from database import AsyncSessionLocal
from models import AuditLog, UserDirectory, TestCaseState
from config import get_settings
from audit_utils import extract_user, _is_valid_display_name

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fix_actors")

async def fetch_zephyr_history(client: httpx.AsyncClient, key: str) -> list:
    try:
        response = await client.get(f"/testcases/{key}/history")
        if response.status_code < 400:
            data = response.json()
            if isinstance(data, list):
                return data
            elif isinstance(data, dict) and "values" in data:
                return data.get("values", [])
    except Exception as e:
        logger.error(f"Failed to fetch history for {key}: {e}")
    return []

async def fetch_detailed_case(client: httpx.AsyncClient, key: str) -> dict:
    try:
        response = await client.get(f"/testcases/{key}")
        if response.status_code < 400:
            return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch {key}: {e}")
    return {}

async def resolve_jira_name(client: httpx.AsyncClient, account_id: str) -> str:
    if not all([settings.jira_base_url, settings.jira_user_email, settings.jira_api_token]):
        return account_id
    try:
        response = await client.get(f"/rest/api/3/user", params={"accountId": account_id})
        if response.status_code < 400:
            payload = response.json()
            if isinstance(payload, dict):
                return payload.get("displayName", account_id)
    except Exception:
        pass
    return account_id

async def process_log_and_resolve_actor(log, zephyr_client, jira_client, states_map, user_cache):
    key = log.zephyr_key
    if not key:
        return None

    actor_acc = log.actor_account
    actor_name = log.actor_name if _is_valid_display_name(log.actor_name) else None

    if actor_acc and actor_name:
        return None

    # 1. Try history
    if not actor_acc:
        history = await fetch_zephyr_history(zephyr_client, key)
        if history:
            creation_event = history[-1]
            actor_acc, actor_name = extract_user(creation_event, "author", "user")

    # 2. Fallback to current owner in DB state
    if not actor_acc and key in states_map:
        fallback_acc, fallback_name, _ = states_map[key]
        if fallback_acc:
            actor_acc = fallback_acc
            if not actor_name and fallback_name:
                actor_name = fallback_name

    # 3. Fallback to detailed test case payload
    if not actor_acc:
        detail = await fetch_detailed_case(zephyr_client, key)
        if detail:
            if log.action == "CREATED":
                actor_acc, actor_name = extract_user(detail, "createdBy", "owner", "author")
            else:
                actor_acc, actor_name = extract_user(detail, "updatedBy", "lastModifiedBy", "owner")

    # 4. Final Fallback: try raw_snapshot from DB state
    if not actor_acc and key in states_map:
        _, _, raw_snapshot = states_map[key]
        if raw_snapshot:
            actor_acc, actor_name = extract_user(raw_snapshot, "createdBy", "updatedBy", "owner", "author")

    # 5. Resolve name via Jira if needed
    if actor_acc:
        if not actor_name or actor_name == actor_acc:
            if actor_acc in user_cache and _is_valid_display_name(user_cache[actor_acc]):
                actor_name = user_cache[actor_acc]
            elif jira_client:
                actor_name = await resolve_jira_name(jira_client, actor_acc)

        resolved_name = actor_name if _is_valid_display_name(actor_name) else actor_acc

        return {
            "log_id": log.id,
            "actor_account": actor_acc,
            "actor_name": resolved_name,
            "is_new_user": actor_acc not in user_cache or user_cache.get(actor_acc) != resolved_name
        }

    return {
        "log_id": log.id,
        "actor_account": "System",
        "actor_name": "System",
        "is_new_user": "System" not in user_cache
    }

async def run_fix():
    settings.require_zephyr_config()

    headers = {"Authorization": f"Bearer {settings.zephyr_api_token}", "Content-Type": "application/json"}
    jira_client = None
    if all([settings.jira_base_url, settings.jira_user_email, settings.jira_api_token]):
        jira_client = httpx.AsyncClient(
            base_url=settings.jira_base_url,
            auth=(settings.jira_user_email, settings.jira_api_token),
            timeout=10.0
        )

    async with httpx.AsyncClient(base_url=settings.zephyr_base_url, headers=headers, timeout=10.0) as zephyr_client:
        async with AsyncSessionLocal() as db:
            logs_res = await db.execute(
                select(AuditLog).where(
                    (AuditLog.actor_account.is_(None)) |
                    (AuditLog.actor_name.is_(None)) |
                    (AuditLog.actor_name == AuditLog.actor_account)
                )
            )
            logs = logs_res.scalars().all()

            if not logs:
                logger.info("No audit logs with missing actors found!")
                return

            logger.info(f"Found {len(logs)} audit logs with missing/unresolved actors. Attempting to resolve...")

            user_cache = {}
            users_res = await db.execute(select(UserDirectory))
            for u in users_res.scalars().all():
                user_cache[u.account_id] = u.display_name

            states_res = await db.execute(select(TestCaseState.zephyr_key, TestCaseState.owner_account, TestCaseState.owner_name, TestCaseState.raw_snapshot))
            states_map = {row.zephyr_key: (row.owner_account, row.owner_name, row.raw_snapshot) for row in states_res.all()}

            semaphore = asyncio.Semaphore(20)

            async def process_log_with_semaphore(log):
                async with semaphore:
                    return await process_log_and_resolve_actor(log, zephyr_client, jira_client, states_map, user_cache)

            tasks = [process_log_with_semaphore(log) for log in logs]
            results = await asyncio.gather(*tasks)

            updated_count = 0
            log_map = {log.id: log for log in logs}
            new_users_to_add = {}

            for result in results:
                if result:
                    log = log_map.get(result["log_id"])
                    if log:
                        log.actor_account = result["actor_account"]
                        log.actor_name = result["actor_name"]
                        updated_count += 1
                        logger.info(f"Resolved {log.zephyr_key} -> {log.actor_name}")

                        if result["is_new_user"]:
                            new_users_to_add[result["actor_account"]] = result["actor_name"]

            if new_users_to_add:
                for acc_id, disp_name in new_users_to_add.items():
                    existing = await db.get(UserDirectory, acc_id)
                    if existing:
                        if existing.display_name != disp_name:
                            existing.display_name = disp_name
                    else:
                        db.add(UserDirectory(account_id=acc_id, display_name=disp_name))

            if updated_count > 0:
                await db.commit()
                logger.info(f"Successfully fixed {updated_count} audit logs!")
            else:
                logger.info("No actors could be resolved.")

    if jira_client:
        await jira_client.aclose()

if __name__ == "__main__":
    asyncio.run(run_fix())