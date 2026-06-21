# schemas.py
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class StatsOut(BaseModel):
    total_cases: int
    total_logs: int
    updates: int
    updates_today: int
    active_cases: int = 0
    out_of_scope_cases: int = 0
    audit_events: int = 0
    changes_today: int = 0
    latest_poll_changes: int = 0
    poll_runs: int = 0
    updated_events: int = 0
    moved_out_events: int = 0
    moved_in_events: int = 0
    deleted_events: int = 0
    automation_coverage: dict[str, Any] = {}
    weekly_activity: list[dict[str, Any]] = []
    contributors_week: list[dict[str, Any]] = []
    weekly_window: dict[str, Any] = {}


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    zephyr_key: str
    project_key: str
    action: str
    actor_account: str | None = None
    actor_name: str | None = None
    poll_run_id: UUID | None = None
    changed_fields: list[str] | None = None
    diff_before: dict[str, Any] | None = None
    diff_after: dict[str, Any] | None = None
    folder_before: str | None = None
    folder_after: str | None = None
    detected_at: datetime
    alerted: bool
    alerted_at: datetime | None = None


class TestCaseStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    zephyr_key: str
    project_key: str
    name: str
    status: str | None = None
    priority: str | None = None
    folder_id: int | None = None
    folder_path: str | None = None
    owner_account: str | None = None
    owner_name: str | None = None
    tm4j_id: int | None = None
    last_seen_at: datetime
    created_in_db: datetime
    is_deleted: bool


class UserProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: str
    display_name: str


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    folder_id: int
    name: str
    full_path: str
    parent_id: int | None = None
    tribe: str | None = None

class ConfigOut(BaseModel):
    project_key: str
    parent_folder_id: int | None
    parent_folder_name: str | None
    base_url: str
    fetch_test_steps: bool
    archive_status_names: list[str]
    api_max_limit: int
    poll_step_concurrency: int

class ZephyrAuditLogItem(BaseModel):
    field: str
    old_value: Any
    new_value: Any

class ZephyrAuditLog(BaseModel):
    author: str
    created: datetime
    items: List[ZephyrAuditLogItem]

# New Schemas for QA Checklist

class ChecklistItemBase(BaseModel):
    status: str = 'pending'
    notes: Optional[str] = None
    bug_id: Optional[str] = None

class ChecklistItemCreate(ChecklistItemBase):
    pass

class ChecklistItemOut(ChecklistItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    release_cycle_id: int
    test_case_id: UUID
    history: Optional[List[dict]] = None
    test_case: Optional[TestCaseStateOut] = None

class ReleaseCycleBase(BaseModel):
    name: str
    status: str = 'active'

class ReleaseCycleCreate(ReleaseCycleBase):
    # Option to create a cycle with a predefined list of test case IDs
    test_case_ids: Optional[List[UUID]] = []

class ReleaseCycleOut(ReleaseCycleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    items: List[ChecklistItemOut] = []


class TestCaseFullOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: Any
    zephyr_key: str
    project_key: str
    name: str
    status: str | None = None
    priority: str | None = None
    folder_id: int | None = None
    folder_path: str | None = None
    owner_account: str | None = None
    owner_name: str | None = None
    last_seen_at: datetime
    created_in_db: datetime
    is_deleted: bool
    raw_snapshot: Optional[dict] = None
    steps_json: Optional[list] = None


class FolderWithCount(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    folder_id: int
    name: str
    full_path: str
    parent_id: int | None = None
    tribe: str | None = None
    test_case_count: int

