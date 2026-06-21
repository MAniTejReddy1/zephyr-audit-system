# models.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Index, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

def utc_now():
    return datetime.now(timezone.utc)

class TestCaseState(Base):
    __tablename__ = "test_case_state"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zephyr_key = Column(String, nullable=False, unique=True, index=True) # e.g. PROJ-T42
    project_key = Column(String, nullable=False)
    name = Column(String, nullable=False)
    status = Column(String)
    priority = Column(String)
    folder_id = Column(Integer)
    folder_path = Column(String)
    owner_account = Column(String)
    owner_name = Column(String)
    tm4j_id = Column(Integer)
    
    steps_hash = Column(String) # SHA-256 hash to quickly detect changes
    steps_json = Column(JSONB)  # Storing as JSONB for fast indexing/querying
    raw_snapshot = Column(JSONB) # Keep full payload for future-proofing
    
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    created_in_db = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index('idx_test_case_state_project_deleted', 'project_key', 'is_deleted'),
        Index('idx_test_case_state_folder', 'folder_id'),
        Index('idx_test_case_state_tm4j_id', 'tm4j_id'),
    )


class SyncRun(Base):
    __tablename__ = "sync_run"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status = Column(String, nullable=False, default="running")  # running | completed | failed
    started_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    message = Column(String, nullable=True)
    source = Column(String, nullable=False, default="manual")  # manual | auto | cli
    total_fetched = Column(Integer, nullable=False, default=0)
    total_logged = Column(Integer, nullable=False, default=0)
    created_count = Column(Integer, nullable=False, default=0)
    updated_count = Column(Integer, nullable=False, default=0)
    moved_count = Column(Integer, nullable=False, default=0)
    deleted_count = Column(Integer, nullable=False, default=0)
    unchanged_count = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        Index('idx_sync_run_started', 'started_at'),
        Index('idx_sync_run_status', 'status'),
    )


class CoverageSnapshot(Base):
    """Point-in-time inventory counts; first row each calendar week is the baseline for deltas."""

    __tablename__ = "coverage_snapshot"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    total_cases = Column(Integer, nullable=False)
    automated_cases = Column(Integer, nullable=False)
    manual_cases = Column(Integer, nullable=False)
    # Denormalized / reserved for dashboards (stored as zeros today; extensible later)
    created_count = Column(Integer, nullable=False, default=0)
    moved_in_count = Column(Integer, nullable=False, default=0)
    moved_out_count = Column(Integer, nullable=False, default=0)
    deleted_count = Column(Integer, nullable=False, default=0)

    __table_args__ = (Index("idx_coverage_snapshot_recorded", "recorded_at"),)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zephyr_key = Column(String, nullable=False)
    project_key = Column(String, nullable=False)
    
    # Action types: CREATED | UPDATED | MOVED | ARCHIVED | DELETED | RESTORED
    action = Column(String, nullable=False) 
    
    actor_account = Column(String)
    actor_name = Column(String)
    poll_run_id = Column(UUID(as_uuid=True), nullable=True)
    
    changed_fields = Column(ARRAY(String)) # e.g. ['name', 'steps', 'status']
    diff_before = Column(JSONB)
    diff_after = Column(JSONB)
    folder_before = Column(String)
    folder_after = Column(String)
    
    detected_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    
    # Alerting state
    alerted = Column(Boolean, nullable=False, default=False)
    alerted_at = Column(DateTime(timezone=True), nullable=True)

    # Backfill idempotency key
    source_event_id = Column(String, nullable=True)

    # Indexes for fast querying on the dashboard
    __table_args__ = (
        Index('idx_audit_log_key', 'zephyr_key'),
        Index('idx_audit_log_project', 'project_key'),
        Index('idx_audit_log_action', 'action'),
        Index('idx_audit_log_actor', 'actor_account'),
        Index('idx_audit_log_poll_run', 'poll_run_id'),
        Index('idx_audit_log_unalerted', 'alerted', postgresql_where=(alerted == False)),
        Index('uq_audit_source_event', 'zephyr_key', 'source_event_id', unique=True, postgresql_where=(source_event_id.isnot(None))),
    )


class FolderMap(Base):
    __tablename__ = "folder_map"

    folder_id = Column(Integer, primary_key=True)
    project_key = Column(String, nullable=False)
    name = Column(String, nullable=False)
    parent_id = Column(Integer, nullable=True)
    full_path = Column(String, nullable=False) # "Web > Functional > Login"
    tribe = Column(String, nullable=True)      # Manual tag: "Payments Tribe"
    synced_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class UserDirectory(Base):
    __tablename__ = "user_directory"

    account_id = Column(String, primary_key=True)
    display_name = Column(String, nullable=False)
    last_synced = Column(DateTime(timezone=True), nullable=False, default=utc_now)

# New Models for QA Checklist Feature
class ReleaseCycle(Base):
    __tablename__ = 'release_cycles'
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    status = Column(String, nullable=False, default='active')  # e.g., active, completed, archived
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship to its items
    items = relationship("ChecklistItem", back_populates="cycle", cascade="all, delete-orphan")

class ChecklistItem(Base):
    __tablename__ = 'checklist_items'
    id = Column(Integer, primary_key=True)
    release_cycle_id = Column(Integer, ForeignKey('release_cycles.id'), nullable=False)
    test_case_id = Column(UUID(as_uuid=True), ForeignKey('test_case_state.id'), nullable=False)

    status = Column(String, nullable=False, default='pending')
    notes = Column(Text)
    bug_id = Column(String)
    history = Column(JSON) # To store status change history

    # Relationships
    cycle = relationship("ReleaseCycle", back_populates="items")
    test_case = relationship("TestCaseState")
