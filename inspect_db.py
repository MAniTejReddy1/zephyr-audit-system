import asyncio
from database import AsyncSessionLocal
from models import AuditLog, TestCaseState
from sqlalchemy import select

async def inspect():
    async with AsyncSessionLocal() as db:
        logs = (await db.execute(select(AuditLog).where(AuditLog.actor_account.is_(None)))).scalars().all()
        print(f"AuditLogs with None actor_account: {len(logs)}")
        if logs:
            print(f"First one action: {logs[0].action}, key: {logs[0].zephyr_key}")

        states = (await db.execute(select(TestCaseState))).scalars().all()
        no_owner = sum(1 for s in states if s.owner_account is None)
        print(f"TestCaseStates with None owner_account: {no_owner} / {len(states)}")
        if states:
            print(f"Sample owner_account: {states[0].owner_account}, owner_name: {states[0].owner_name}")

asyncio.run(inspect())