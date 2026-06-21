import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select, update

from config import get_settings
from database import AsyncSessionLocal
from models import AuditLog

settings = get_settings()
logger = logging.getLogger("zephyr_audit.alert_worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _format_log_line(log: AuditLog) -> str:
    actor = log.actor_name or log.actor_account or "System Sync"
    changed = ", ".join(log.changed_fields or []) or "snapshot"
    return f"*{log.action}* `{log.zephyr_key}` by {actor} ({changed})"


def build_slack_payload(logs: list[AuditLog]) -> dict[str, Any]:
    lines = [_format_log_line(log) for log in logs]
    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"Zephyr Audit Alert ({len(logs)} changes)",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "\n".join(lines[:40]),
            },
        },
    ]
    if len(lines) > 40:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"+ {len(lines) - 40} more changes in this batch"}],
        })
    return {"blocks": blocks}


async def post_to_slack_with_retry(payload: dict[str, Any]) -> bool:
    if not settings.slack_webhook_url:
        raise RuntimeError("SLACK_WEBHOOK_URL is required to deliver alerts")

    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(settings.alert_max_retries):
            try:
                response = await client.post(settings.slack_webhook_url, json=payload)
                if 200 <= response.status_code < 300:
                    return True
                logger.warning("Slack attempt %s failed with status %s", attempt + 1, response.status_code)
            except httpx.RequestError as exc:
                logger.warning("Slack attempt %s failed: %s", attempt + 1, exc)

            if attempt < settings.alert_max_retries - 1:
                await asyncio.sleep(settings.alert_initial_delay_seconds * (2 ** attempt))

    return False


async def process_queue() -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AuditLog)
            .where(AuditLog.alerted.is_(False))
            .order_by(AuditLog.detected_at.asc())
            .limit(settings.alert_batch_size)
        )
        logs = result.scalars().all()

    if not logs:
        logger.info("No unalerted audit logs found")
        return 0

    payload = build_slack_payload(logs)
    if not await post_to_slack_with_retry(payload):
        logger.error("Slack delivery failed after %s attempts", settings.alert_max_retries)
        return 0

    log_ids = [log.id for log in logs]
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(
                update(AuditLog)
                .where(AuditLog.id.in_(log_ids))
                .values(alerted=True, alerted_at=datetime.now(timezone.utc))
            )

    logger.info("Delivered and marked %s audit alerts", len(logs))
    return len(logs)


if __name__ == "__main__":
    asyncio.run(process_queue())
