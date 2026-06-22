# schemas.py
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


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


class TestCaseStateDetailOut(TestCaseStateOut):
    raw_snapshot: Optional[dict[str, Any]] = None
    steps_json: Optional[list[Any]] = None



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
    platform: Optional[str] = None
    assigned_to: Optional[str] = None
    evidence: Optional[List[dict]] = None
    parent_id: Optional[int] = None

class ChecklistItemCreate(ChecklistItemBase):
    checklist_label: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    bug_id: Optional[str] = None
    platform: Optional[str] = None
    assigned_to: Optional[str] = None
    evidence: Optional[List[dict]] = None

class ChecklistItemOut(ChecklistItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    release_cycle_id: int
    test_case_id: UUID
    history: Optional[List[dict]] = None
    test_case: Optional[TestCaseStateOut] = None

class ChecklistItemListOut(ChecklistItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    release_cycle_id: int
    test_case_id: UUID
    history: Optional[List[dict]] = None
    test_case: Optional[TestCaseStateOut] = None
    
    checklist_label: Optional[str] = None
    module: Optional[str] = None
    transform_version: int
    label_overridden: bool
    precondition_present: bool = False
    verification_point_count: int = 0

    @field_validator('transform_version', mode='before')
    @classmethod
    def transform_version_default(cls, v):
        return v if v is not None else 0

    @field_validator('label_overridden', mode='before')
    @classmethod
    def label_overridden_default(cls, v):
        return v if v is not None else False


class ChecklistItemDetailOut(ChecklistItemListOut):
    test_case: Optional[TestCaseStateDetailOut] = None
    verification_points: List[str] = []
    precondition: Optional[str] = None

class ReleaseCycleBase(BaseModel):
    name: str
    status: str = 'active'
    release_cycle: Optional[str] = None
    version: Optional[str] = None
    squad: Optional[str] = None
    build_version: Optional[str] = None
    owner: Optional[str] = None
    deadline: Optional[datetime] = None

class ReleaseCycleCreate(ReleaseCycleBase):
    # Option to create a cycle with a predefined list of test case IDs
    test_case_ids: Optional[List[UUID]] = []

class ReleaseCycleOut(ReleaseCycleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    items: List[ChecklistItemListOut] = []



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


class TransformerConfigSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    filler_verbs: List[str]
    generic_words: List[str]


class TransformerConfigUpdate(BaseModel):
    filler_verbs: Optional[List[str]] = None
    generic_words: Optional[List[str]] = None


