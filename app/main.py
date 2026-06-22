from contextlib import asynccontextmanager
from fastapi import FastAPI
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.config import get_settings
from app.db.session import engine, AsyncSessionLocal
from app.db.base import Base
from app.services.coverage import ensure_calendar_week_opening_snapshot

# Import Routers
from app.api.routers import core, logs, testcases, sync, cycles, jira, transformer


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema and migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Defensive raw SQL alterations for ReleaseCycle hierarchical fields
        await conn.execute(text("ALTER TABLE release_cycles ADD COLUMN IF NOT EXISTS release_cycle VARCHAR;"))
        await conn.execute(text("ALTER TABLE release_cycles ADD COLUMN IF NOT EXISTS version VARCHAR;"))
        await conn.execute(text("ALTER TABLE release_cycles ADD COLUMN IF NOT EXISTS squad VARCHAR;"))
        await conn.execute(text("ALTER TABLE release_cycles ADD COLUMN IF NOT EXISTS build_version VARCHAR;"))
        await conn.execute(text("ALTER TABLE release_cycles ADD COLUMN IF NOT EXISTS owner VARCHAR;"))
        await conn.execute(text("ALTER TABLE release_cycles ADD COLUMN IF NOT EXISTS deadline TIMESTAMP WITH TIME ZONE;"))

        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
            RETURNS trigger AS $$
            BEGIN
                IF current_setting('app.allow_audit_log_mutation', true) = 'on' THEN
                    IF TG_OP = 'UPDATE' THEN
                        RETURN NEW;
                    END IF;
                    RETURN OLD;
                END IF;
                IF TG_OP = 'UPDATE'
                   AND NEW.id IS NOT DISTINCT FROM OLD.id
                   AND NEW.zephyr_key IS NOT DISTINCT FROM OLD.zephyr_key
                   AND NEW.project_key IS NOT DISTINCT FROM OLD.project_key
                   AND NEW.action IS NOT DISTINCT FROM OLD.action
                   AND NEW.poll_run_id IS NOT DISTINCT FROM OLD.poll_run_id
                   AND NEW.changed_fields IS NOT DISTINCT FROM OLD.changed_fields
                   AND NEW.diff_before IS NOT DISTINCT FROM OLD.diff_before
                   AND NEW.diff_after IS NOT DISTINCT FROM OLD.diff_after
                   AND NEW.folder_before IS NOT DISTINCT FROM OLD.folder_before
                   AND NEW.folder_after IS NOT DISTINCT FROM OLD.folder_after
                   AND NEW.detected_at IS NOT DISTINCT FROM OLD.detected_at
                THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION 'audit_log is append-only; use the force reset path to clear audit history';
            END;
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text("DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log"))
        await conn.execute(text("""
            CREATE TRIGGER audit_log_append_only
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
        """))
    
    async with AsyncSessionLocal() as startup_db:
        from sqlalchemy import select
        from app.db.models import TransformerConfig
        
        await ensure_calendar_week_opening_snapshot(startup_db)
        
        # Seed default TransformerConfig if not present
        config_result = await startup_db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
        if not config_result.scalar_one_or_none():
            default_config = TransformerConfig(
                key="default",
                filler_verbs=["verify that", "check that", "ensure", "validate", "verify", "check", "to verify", "to check", "to ensure"],
                generic_words=["web", "functional", "regression", "sanity", "test cases", "mobile", "android", "ios", "api", "integration"]
            )
            startup_db.add(default_config)
            await startup_db.commit()
    
    yield
    await engine.dispose()



app = FastAPI(title="ScopeGuard QA API", lifespan=lifespan)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(core.router)
app.include_router(logs.router)
app.include_router(testcases.router)
app.include_router(sync.router)
app.include_router(cycles.router)
app.include_router(jira.router)
app.include_router(transformer.router)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
