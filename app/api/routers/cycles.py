from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.db.models import ReleaseCycle, ChecklistItem, FolderMap, TestCaseState
from app.schemas.schemas import ReleaseCycleCreate, ReleaseCycleOut, ChecklistItemCreate, ChecklistItemOut
from app.api.dependencies import require_api_key
from app.utils.connection import manager

settings = get_settings()

router = APIRouter(tags=["cycles"])


@router.post("/api/cycles", response_model=ReleaseCycleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_release_cycle(cycle: ReleaseCycleCreate, db: AsyncSession = Depends(get_db)):
    db_cycle = ReleaseCycle(name=cycle.name, status=cycle.status)
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


@router.get("/api/cycles/{cycle_id}", response_model=ReleaseCycleOut, dependencies=[Depends(require_api_key)])
async def get_release_cycle(cycle_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseCycle).options(joinedload(ReleaseCycle.items).joinedload(ChecklistItem.test_case)).where(ReleaseCycle.id == cycle_id)
    )
    cycle = result.scalars().unique().one_or_none()
    if not cycle:
        raise HTTPException(status_code=404, detail="Release cycle not found")
    return cycle


@router.put("/api/cycles/{cycle_id}/items/{item_id}", response_model=ChecklistItemOut, dependencies=[Depends(require_api_key)])
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
    await manager.broadcast(f'{{"type": "item_update", "data": {ChecklistItemOut.model_validate(db_item).model_dump_json()}}}', cycle_id)

    return db_item


@router.post("/api/cycles/import_from_zephyr", response_model=ReleaseCycleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def import_from_zephyr(folder_id: int, cycle_name: str, db: AsyncSession = Depends(get_db)):
    # 1. Get the selected folder
    folder_result = await db.execute(select(FolderMap).where(FolderMap.folder_id == folder_id))
    folder = folder_result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail=f"Folder ID {folder_id} not found in local database.")

    # 2. Find all test cases in this folder OR sub-folder
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

    # 3. Create a new release cycle
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


@router.websocket("/ws/qa_cycle/{cycle_id}")
async def websocket_endpoint(websocket: WebSocket, cycle_id: int):
    await manager.connect(websocket, cycle_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, cycle_id)
