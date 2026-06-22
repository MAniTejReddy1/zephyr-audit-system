import asyncio
import sys
import os

# Add project root to python path to allow imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import select
from sqlalchemy.orm import joinedload
from app.db.session import AsyncSessionLocal, engine
from app.db.models import ChecklistItem, TestCaseState, TransformerConfig
from app.utils.checklist_transformer import (
    clean_checklist_label, extract_module, extract_verification_points,
    extract_precondition, CURRENT_TRANSFORM_VERSION
)


async def main():
    print("Starting Checklist Transformer Backfill Job...")
    
    async with AsyncSessionLocal() as db:
        # 1. Fetch vocabulary configurations
        config_result = await db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
        config = config_result.scalar_one_or_none()
        filler_verbs = config.filler_verbs if config else None
        generic_words = config.generic_words if config else None
        
        # 2. Fetch all checklist items that need transformation
        # We transform if transform_version < CURRENT_TRANSFORM_VERSION AND label_overridden is False
        stmt = (
            select(ChecklistItem)
            .options(joinedload(ChecklistItem.test_case))
            .where(
                ChecklistItem.label_overridden == False,
                ChecklistItem.transform_version < CURRENT_TRANSFORM_VERSION
            )
        )
        result = await db.execute(stmt)
        items = result.scalars().all()
        
        total = len(items)
        print(f"Found {total} items to backfill.")
        
        if total == 0:
            print("No items require backfill. Exiting.")
            return

        success_count = 0
        failure_count = 0

        for i, item in enumerate(items, 1):
            tc = item.test_case
            if not tc:
                print(f"[{i}/{total}] Skipping ChecklistItem id={item.id} - No linked TestCaseState found.")
                continue
                
            try:
                # Apply transformation
                item.checklist_label = clean_checklist_label(tc.name, filler_verbs)
                item.module = extract_module(tc.folder_path, generic_words)
                item.verification_points = extract_verification_points(tc.steps_json)
                item.precondition = extract_precondition(tc.raw_snapshot)
                item.transform_version = CURRENT_TRANSFORM_VERSION
                
                success_count += 1
                if i % 50 == 0 or i == total:
                    print(f"[{i}/{total}] Transformed item id={item.id} (Key: {tc.zephyr_key})")
            except Exception as e:
                print(f"[{i}/{total}] ERROR transforming item id={item.id} (Key: {tc.zephyr_key}): {e}", file=sys.stderr)
                failure_count += 1
                
        if success_count > 0:
            await db.commit()
            print(f"Successfully committed changes to database.")
            
        print(f"Backfill Job Completed: {success_count} succeeded, {failure_count} failed.")


if __name__ == "__main__":
    asyncio.run(main())
