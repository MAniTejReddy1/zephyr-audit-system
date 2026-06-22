import asyncio
import os
import sys

# Add the project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import text
from app.db.session import AsyncSessionLocal

async def clear_cycles():
    async with AsyncSessionLocal() as session:
        # TRUNCATE the tables to efficiently delete all rows and reset identities if applicable.
        # CASCADE ensures child tables like checklist_items are also truncated.
        await session.execute(text("TRUNCATE TABLE release_cycles CASCADE;"))
        await session.commit()
        print("Successfully deleted all release portal records (cycles and checklist items).")

if __name__ == "__main__":
    asyncio.run(clear_cycles())
