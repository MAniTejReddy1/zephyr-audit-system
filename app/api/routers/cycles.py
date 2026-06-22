from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select, or_, text, func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.db.models import ReleaseCycle, ChecklistItem, FolderMap, TestCaseState, TransformerConfig
from app.schemas.schemas import (
    ReleaseCycleCreate, ReleaseCycleOut, ChecklistItemCreate, ChecklistItemOut,
    ChecklistItemListOut, ChecklistItemDetailOut, ReleaseCycleUpdate, ReleaseCycleClone,
    BulkRemoveItems
)
from app.api.dependencies import require_api_key
from app.utils.connection import manager
from app.utils.checklist_transformer import (
    clean_checklist_label, extract_module, extract_verification_points, 
    extract_precondition, CURRENT_TRANSFORM_VERSION
)
import logging

settings = get_settings()

router = APIRouter(tags=["cycles"])



@router.post("/api/cycles", response_model=ReleaseCycleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_release_cycle(cycle: ReleaseCycleCreate, db: AsyncSession = Depends(get_db)):
    # Automatically split name if parts are not passed
    release_cycle = cycle.release_cycle
    version = cycle.version
    squad = cycle.squad
    if not release_cycle or not version or not squad:
        parts = [p.strip() for p in cycle.name.split('/')]
        if len(parts) >= 3:
            release_cycle = release_cycle or parts[0]
            version = version or parts[1]
            squad = squad or parts[2]
        else:
            release_cycle = release_cycle or cycle.name
            version = version or "v1.0.0"
            squad = squad or "Core"

    db_cycle = ReleaseCycle(
        name=cycle.name, 
        status=cycle.status,
        release_cycle=release_cycle,
        version=version,
        squad=squad,
        build_version=cycle.build_version,
        owner=cycle.owner,
        deadline=cycle.deadline
    )
    if cycle.test_case_ids:
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
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == db_cycle.id)
    )
    return result.scalars().unique().one()


@router.get("/api/cycles", response_model=List[ReleaseCycleOut], dependencies=[Depends(require_api_key)])
async def get_release_cycles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).order_by(ReleaseCycle.created_at.desc()))
    return result.scalars().unique().all()


@router.get("/api/cycles/preview_import_count", dependencies=[Depends(require_api_key)])
async def preview_import_count(
    folder_id: List[int] = Query(...),
    case_type: Optional[str] = Query(None),
    priorities: Optional[List[str]] = Query(None),
    labels: Optional[List[str]] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    # 1. Get the selected folders
    folder_result = await db.execute(select(FolderMap).where(FolderMap.folder_id.in_(folder_id)))
    folders = folder_result.scalars().all()
    if not folders:
        return {"count": 0}

    # 2. Find all test cases in these folders OR sub-folders
    conditions = []
    for folder in folders:
        path_prefix = folder.full_path
        conditions.append(TestCaseState.folder_id == folder.folder_id)
        conditions.append(TestCaseState.folder_path.like(f"{path_prefix} > %"))

    stmt = select(TestCaseState).where(
        TestCaseState.is_deleted == False,
        or_(*conditions)
    )

    if case_type == "automated":
        automated_json_expr = """(
        (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
        OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
        )"""
        stmt = stmt.where(text(automated_json_expr))
    elif case_type == "manual":
        automated_json_expr = """(
        (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
        OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
        )"""
        stmt = stmt.where(or_(
            text(f"NOT {automated_json_expr}"),
            TestCaseState.raw_snapshot.is_(None)
        ))

    if priorities:
        cond = [TestCaseState.priority.in_(priorities)]
        if "Normal" in priorities:
            cond.append(TestCaseState.priority.is_(None))
            cond.append(TestCaseState.priority == "")
        stmt = stmt.where(or_(*cond))

    if labels:
        stmt = stmt.where(or_(*[TestCaseState.raw_snapshot['labels'].contains([lbl.lower()]) for lbl in labels]))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    result = await db.execute(count_stmt)
    total_count = result.scalar() or 0
    return {"count": total_count}


@router.get("/api/cycles/{cycle_id}", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def get_release_cycle(cycle_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == cycle_id)
    )
    cycle = result.scalars().unique().one_or_none()
    if not cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")
    return cycle


@router.put("/api/cycles/{cycle_id}/items/{item_id}", response_model=ChecklistItemListOut, dependencies=[Depends(require_api_key)])
async def update_checklist_item(cycle_id: int, item_id: int, item_update: ChecklistItemCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.release_cycle_id == cycle_id)
    )
    db_item = result.scalar_one_or_none()
    if not db_item:
        raise HTTPException(status_code=404, detail="Checklist item not found")

    update_data = item_update.model_dump(exclude_unset=True)

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
    await manager.broadcast(f'{{"type": "item_update", "data": {ChecklistItemListOut.model_validate(db_item).model_dump_json()}}}', cycle_id)

    return db_item


@router.get("/api/cycles/{cycle_id}/items/{item_id}", response_model=ChecklistItemDetailOut, dependencies=[Depends(require_api_key)])
async def get_checklist_item_details(cycle_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChecklistItem).options(joinedload(ChecklistItem.test_case)).where(ChecklistItem.id == item_id, ChecklistItem.release_cycle_id == cycle_id)
    )
    db_item = result.scalar_one_or_none()
    if not db_item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return db_item


@router.patch("/api/cycles/{cycle_id}/items/{item_id}", response_model=ChecklistItemDetailOut, dependencies=[Depends(require_api_key)])
async def patch_checklist_item(cycle_id: int, item_id: int, item_update: ChecklistItemCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChecklistItem).options(joinedload(ChecklistItem.test_case)).where(ChecklistItem.id == item_id, ChecklistItem.release_cycle_id == cycle_id)
    )
    db_item = result.scalar_one_or_none()
    if not db_item:
        raise HTTPException(status_code=404, detail="Checklist item not found")

    update_data = item_update.model_dump(exclude_unset=True)

    if 'status' in update_data and update_data['status'] != db_item.status:
        history_entry = {
            'old_status': db_item.status,
            'new_status': update_data['status'],
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }
        current_history = db_item.history or []
        current_history.append(history_entry)
        db_item.history = current_history

    if 'checklist_label' in update_data:
        # If user changed it, set label_overridden to True
        if update_data['checklist_label'] != db_item.checklist_label:
            db_item.label_overridden = True

    for key, value in update_data.items():
        setattr(db_item, key, value)

    await db.commit()
    await db.refresh(db_item)

    # Broadcast update using ChecklistItemListOut schema to keep websocket traffic low
    await manager.broadcast(f'{{"type": "item_update", "data": {ChecklistItemListOut.model_validate(db_item).model_dump_json()}}}', cycle_id)

    return db_item


@router.post("/api/cycles/{cycle_id}/items/{item_id}/regenerate", response_model=ChecklistItemDetailOut, dependencies=[Depends(require_api_key)])
async def regenerate_checklist_item(cycle_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChecklistItem).options(joinedload(ChecklistItem.test_case)).where(ChecklistItem.id == item_id, ChecklistItem.release_cycle_id == cycle_id)
    )
    db_item = result.scalar_one_or_none()
    if not db_item or not db_item.test_case:
        raise HTTPException(status_code=404, detail="Checklist item or source test case not found")

    # Load configuration
    config_result = await db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
    config = config_result.scalar_one_or_none()
    filler_verbs = config.filler_verbs if config else None
    generic_words = config.generic_words if config else None

    # Re-run transformation
    tc = db_item.test_case
    try:
        db_item.checklist_label = clean_checklist_label(tc.name, filler_verbs)
        db_item.module = extract_module(tc.folder_path, generic_words)
        db_item.verification_points = extract_verification_points(tc.steps_json)
        db_item.precondition = extract_precondition(tc.raw_snapshot)
        db_item.transform_version = CURRENT_TRANSFORM_VERSION
        db_item.label_overridden = False
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to transform checklist item: {str(e)}")

    await db.commit()
    await db.refresh(db_item)

    # Broadcast update
    await manager.broadcast(f'{{"type": "item_update", "data": {ChecklistItemListOut.model_validate(db_item).model_dump_json()}}}', cycle_id)

    return db_item



@router.post("/api/cycles/import_from_zephyr", response_model=ReleaseCycleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def import_from_zephyr(
    folder_id: List[int] = Query(...), 
    cycle_name: str = Query(...), 
    release_cycle: Optional[str] = Query(None),
    version: Optional[str] = Query(None),
    squad: Optional[str] = Query(None),
    platforms: Optional[List[str]] = Query(None),
    case_type: Optional[str] = Query(None), # "manual", "automated", "all"
    priorities: Optional[List[str]] = Query(None),
    labels: Optional[List[str]] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    # 1. Get the selected folders
    folder_result = await db.execute(select(FolderMap).where(FolderMap.folder_id.in_(folder_id)))
    folders = folder_result.scalars().all()
    if not folders:
        raise HTTPException(status_code=404, detail=f"None of the folder IDs {folder_id} found in local database.")

    # 2. Find all test cases in these folders OR sub-folders
    conditions = []
    for folder in folders:
        path_prefix = folder.full_path
        conditions.append(TestCaseState.folder_id == folder.folder_id)
        conditions.append(TestCaseState.folder_path.like(f"{path_prefix} > %"))

    stmt = select(TestCaseState).where(
        TestCaseState.is_deleted == False,
        or_(*conditions)
    )

    if case_type == "automated":
        automated_json_expr = """(
        (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
        OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
        )"""
        stmt = stmt.where(text(automated_json_expr))
    elif case_type == "manual":
        automated_json_expr = """(
        (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
        OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
        )"""
        stmt = stmt.where(or_(
            text(f"NOT {automated_json_expr}"),
            TestCaseState.raw_snapshot.is_(None)
        ))

    if priorities:
        cond = [TestCaseState.priority.in_(priorities)]
        if "Normal" in priorities:
            cond.append(TestCaseState.priority.is_(None))
            cond.append(TestCaseState.priority == "")
        stmt = stmt.where(or_(*cond))

    if labels:
        stmt = stmt.where(or_(*[TestCaseState.raw_snapshot['labels'].contains([lbl.lower()]) for lbl in labels]))

    test_cases_result = await db.execute(stmt)
    test_cases = test_cases_result.scalars().unique().all()

    if not test_cases:
        raise HTTPException(status_code=404, detail="No active test cases found matching the filters in the selected folders.")

    # Split cycle_name if parts are not passed
    if not release_cycle or not version or not squad:
        parts = [p.strip() for p in cycle_name.split('/')]
        if len(parts) >= 3:
            release_cycle = release_cycle or parts[0]
            version = version or parts[1]
            squad = squad or parts[2]
        else:
            release_cycle = release_cycle or cycle_name
            version = version or "v1.0.0"
            squad = squad or "Core"

    # Load configuration
    config_result = await db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
    config = config_result.scalar_one_or_none()
    filler_verbs = config.filler_verbs if config else None
    generic_words = config.generic_words if config else None

    # 3. Create a new release cycle
    db_cycle = ReleaseCycle(
        name=cycle_name,
        release_cycle=release_cycle,
        version=version,
        squad=squad
    )
    
    # If no platforms selected, default to a single None platform
    effective_platforms = platforms if platforms and len(platforms) > 0 else [None]

    for tc in test_cases:
        try:
            label = clean_checklist_label(tc.name, filler_verbs)
            mod = extract_module(tc.folder_path, generic_words)
            v_points = extract_verification_points(tc.steps_json)
            precond = extract_precondition(tc.raw_snapshot)
            transform_ver = CURRENT_TRANSFORM_VERSION
        except Exception as e:
            logging.warning(f"Failed to transform test case {tc.zephyr_key} during import: {e}")
            label = tc.name[:80] if tc.name else "Untitled checklist item"
            mod = "Uncategorized"
            v_points = []
            precond = None
            transform_ver = 0

        for plat in effective_platforms:
            item = ChecklistItem(
                test_case_id=tc.id,
                checklist_label=label,
                module=mod,
                verification_points=v_points,
                precondition=precond,
                transform_version=transform_ver,
                label_overridden=False,
                platform=plat
            )
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




@router.put("/api/cycles/{cycle_id}", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def update_release_cycle(cycle_id: int, cycle_update: ReleaseCycleUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == cycle_id)
    )
    db_cycle = result.scalars().unique().one_or_none()
    if not db_cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")

    update_data = cycle_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_cycle, key, value)

    try:
        await db.commit()
        await db.refresh(db_cycle)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A release cycle with name '{cycle_update.name}' already exists.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"An unexpected database error occurred: {str(e)}")
    
    # Broadcast to websockets
    await manager.broadcast(f'{{"type": "cycle_update", "data": {ReleaseCycleOut.model_validate(db_cycle).model_dump_json()}}}', cycle_id)
    return db_cycle


@router.post("/api/cycles/{cycle_id}/clone", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def clone_release_cycle(cycle_id: int, clone_data: ReleaseCycleClone, db: AsyncSession = Depends(get_db)):
    # 1. Fetch source cycle
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items)).where(ReleaseCycle.id == cycle_id)
    )
    src_cycle = result.scalars().unique().one_or_none()
    if not src_cycle:
        raise HTTPException(status_code=404, detail="Source release cycle not found")

    # 2. Check if clone name already exists
    dup_check = await db.execute(select(ReleaseCycle).where(ReleaseCycle.name == clone_data.name))
    if dup_check.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"A release cycle with name '{clone_data.name}' already exists.")

    # 3. Determine squad, version, release_cycle
    release_cycle = clone_data.release_cycle
    version = clone_data.version
    squad = clone_data.squad
    if not release_cycle or not version or not squad:
        parts = [p.strip() for p in clone_data.name.split('/')]
        if len(parts) >= 3:
            release_cycle = release_cycle or parts[0]
            version = version or parts[1]
            squad = squad or parts[2]
        else:
            release_cycle = release_cycle or clone_data.name
            version = version or src_cycle.version or "v1.0.0"
            squad = squad or src_cycle.squad or "Core"

    # 4. Create new cycle
    new_cycle = ReleaseCycle(
        name=clone_data.name,
        status="active",
        release_cycle=release_cycle,
        version=version,
        squad=squad,
        build_version=src_cycle.build_version,
        owner=src_cycle.owner,
        deadline=src_cycle.deadline
    )

    # 5. Clone checklist items
    old_to_new_map = {}

    for item in src_cycle.items:
        new_item = ChecklistItem(
            test_case_id=item.test_case_id,
            status="pending",
            notes=None,
            bug_id=None,
            history=None,
            platform=item.platform,
            assigned_to=None,
            evidence=None,
            checklist_label=item.checklist_label,
            module=item.module,
            verification_points=item.verification_points,
            precondition=item.precondition,
            transform_version=item.transform_version,
            label_overridden=item.label_overridden
        )
        new_cycle.items.append(new_item)
        old_to_new_map[item.id] = new_item

    # Save to get new IDs
    db.add(new_cycle)
    await db.flush()

    # Set parents for cloned items
    for item in src_cycle.items:
        if item.parent_id and item.parent_id in old_to_new_map:
            cloned_item = old_to_new_map[item.id]
            cloned_parent = old_to_new_map[item.parent_id]
            cloned_item.parent_id = cloned_parent.id

    await db.commit()
    await db.refresh(new_cycle)

    # Return newly created cycle
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == new_cycle.id)
    )
    return result.scalars().unique().one()


@router.delete("/api/cycles/{cycle_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_api_key)])
async def delete_release_cycle(cycle_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ReleaseCycle).where(ReleaseCycle.id == cycle_id))
    cycle = result.scalar_one_or_none()
    if not cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")

    # Set parent_id of all items in this cycle to None to prevent foreign key self-reference violations during cascade delete
    await db.execute(
        update(ChecklistItem)
        .where(ChecklistItem.release_cycle_id == cycle_id)
        .values(parent_id=None)
    )

    await db.delete(cycle)
    await db.commit()
    return None


@router.post("/api/cycles/{cycle_id}/import_cases", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def import_cases_to_cycle(
    cycle_id: int,
    folder_id: List[int] = Query(...),
    platforms: Optional[List[str]] = Query(None),
    case_type: Optional[str] = Query(None),
    priorities: Optional[List[str]] = Query(None),
    labels: Optional[List[str]] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    # 1. Fetch cycle
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items)).where(ReleaseCycle.id == cycle_id)
    )
    cycle = result.scalars().unique().one_or_none()
    if not cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")

    # 2. Get the selected folders
    folder_result = await db.execute(select(FolderMap).where(FolderMap.folder_id.in_(folder_id)))
    folders = folder_result.scalars().all()
    if not folders:
        raise HTTPException(status_code=404, detail=f"None of the folder IDs {folder_id} found in local database.")

    # 3. Find all test cases in these folders OR sub-folders
    conditions = []
    for folder in folders:
        path_prefix = folder.full_path
        conditions.append(TestCaseState.folder_id == folder.folder_id)
        conditions.append(TestCaseState.folder_path.like(f"{path_prefix} > %"))

    stmt = select(TestCaseState).where(
        TestCaseState.is_deleted == False,
        or_(*conditions)
    )

    if case_type == "automated":
        automated_json_expr = """(
        (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
        OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
        )"""
        stmt = stmt.where(text(automated_json_expr))
    elif case_type == "manual":
        automated_json_expr = """(
        (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_api}', ''))) IN ('yes','true','1','y'))
        OR (lower(trim(coalesce(raw_snapshot #>> '{customFields,is_automated_in_app}', ''))) IN ('yes','true','1','y'))
        )"""
        stmt = stmt.where(or_(
            text(f"NOT {automated_json_expr}"),
            TestCaseState.raw_snapshot.is_(None)
        ))

    if priorities:
        cond = [TestCaseState.priority.in_(priorities)]
        if "Normal" in priorities:
            cond.append(TestCaseState.priority.is_(None))
            cond.append(TestCaseState.priority == "")
        stmt = stmt.where(or_(*cond))

    if labels:
        stmt = stmt.where(or_(*[TestCaseState.raw_snapshot['labels'].contains([lbl.lower()]) for lbl in labels]))

    test_cases_result = await db.execute(stmt)
    test_cases = test_cases_result.scalars().unique().all()

    # 4. Filter out duplicates already in this cycle
    existing_keys = {(item.test_case_id, item.platform) for item in cycle.items}
    
    # Load config
    config_result = await db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
    config = config_result.scalar_one_or_none()
    filler_verbs = config.filler_verbs if config else None
    generic_words = config.generic_words if config else None

    effective_platforms = platforms if platforms and len(platforms) > 0 else [None]

    for tc in test_cases:
        for plat in effective_platforms:
            if (tc.id, plat) in existing_keys:
                continue

            try:
                label = clean_checklist_label(tc.name, filler_verbs)
                mod = extract_module(tc.folder_path, generic_words)
                v_points = extract_verification_points(tc.steps_json)
                precond = extract_precondition(tc.raw_snapshot)
                transform_ver = CURRENT_TRANSFORM_VERSION
            except Exception as e:
                logging.warning(f"Failed to transform test case {tc.zephyr_key} during import: {e}")
                label = tc.name[:80] if tc.name else "Untitled checklist item"
                mod = "Uncategorized"
                v_points = []
                precond = None
                transform_ver = 0

            item = ChecklistItem(
                test_case_id=tc.id,
                checklist_label=label,
                module=mod,
                verification_points=v_points,
                precondition=precond,
                transform_version=transform_ver,
                label_overridden=False,
                platform=plat
            )
            cycle.items.append(item)

    await db.commit()

    # Re-query with joinedload to ensure test_case is populated for serialization
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == cycle_id)
    )
    cycle = result.scalars().unique().one()

    # Broadcast update
    await manager.broadcast(f'{{"type": "cycle_update", "data": {ReleaseCycleOut.model_validate(cycle).model_dump_json()}}}', cycle_id)
    return cycle


@router.post("/api/cycles/{cycle_id}/remove_items", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def remove_items_from_cycle(cycle_id: int, remove_payload: BulkRemoveItems, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == cycle_id)
    )
    cycle = result.scalars().unique().one_or_none()
    if not cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")

    item_ids_set = set(remove_payload.item_ids)
    
    items_to_keep = []
    items_to_delete = []
    for item in cycle.items:
        if item.id in item_ids_set:
            items_to_delete.append(item)
        else:
            items_to_keep.append(item)

    if not items_to_delete:
        return cycle

    # Nullify parent_id for any checklist item that has parent_id pointing to the items being removed
    await db.execute(
        update(ChecklistItem)
        .where(ChecklistItem.release_cycle_id == cycle_id)
        .where(ChecklistItem.parent_id.in_(remove_payload.item_ids))
        .values(parent_id=None)
    )

    for item in items_to_delete:
        await db.delete(item)

    await db.commit()
    await db.refresh(cycle)

    # Broadcast update
    await manager.broadcast(f'{{"type": "cycle_update", "data": {ReleaseCycleOut.model_validate(cycle).model_dump_json()}}}', cycle_id)
    return cycle


@router.websocket("/ws/qa_cycle/{cycle_id}")
async def websocket_endpoint(websocket: WebSocket, cycle_id: int):
    await manager.connect(websocket, cycle_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, cycle_id)
