# config.py
from dataclasses import dataclass
from functools import lru_cache
import os

from dotenv import load_dotenv

load_dotenv()


def _csv_env(name: str, default: str) -> tuple[str, ...]:
    raw = os.getenv(name, default)
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _int_env(name: str, default: int | None = None) -> int | None:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc


def _missing_secret(value: str | None) -> bool:
    return not value or value.startswith("replace-with")


@dataclass(frozen=True)
class Settings:
    database_url: str
    zephyr_api_token: str | None
    zephyr_project_key: str
    zephyr_parent_folder_id: int | None
    zephyr_base_url: str
    zephyr_fetch_test_steps: bool
    audit_api_key: str | None
    cors_origins: tuple[str, ...]
    api_max_limit: int
    poll_page_size: int
    poll_step_concurrency: int
    request_timeout_seconds: float
    archive_status_names: tuple[str, ...]
    zephyr_audit_endpoint_template: str | None
    jira_base_url: str | None
    jira_user_email: str | None
    jira_api_token: str | None
    slack_webhook_url: str | None
    alert_batch_size: int
    alert_max_retries: int
    alert_initial_delay_seconds: float
    # Poller concurrency settings
    folder_fetch_concurrency: int
    test_step_fetch_concurrency: int
    # API rate limiting
    rate_limit_per_minute: int
    # Retry settings
    api_retry_count: int
    api_retry_delay_seconds: float
    # TM4J browser backend (history / changed-by)
    tm4j_base_url: str | None
    tm4j_jwt: str | None
    tm4j_jira_project_id: int | None
    tm4j_history_concurrency: int
    # Sidebar weekly metrics: Monday 00:00 boundary in this IANA timezone (ex: Asia/Kolkata)
    stats_timezone: str

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+asyncpg", "+psycopg2").replace("asyncpg", "psycopg2")

    def require_zephyr_config(self) -> None:
        missing = []
        if _missing_secret(self.zephyr_api_token):
            missing.append("ZEPHYR_API_TOKEN")
        if not self.zephyr_project_key:
            missing.append("ZEPHYR_PROJECT_KEY")
        if self.zephyr_parent_folder_id is None:
            missing.append("ZEPHYR_PARENT_FOLDER_ID")
        if missing:
            raise RuntimeError("Missing required Zephyr configuration: " + ", ".join(missing))

    def require_api_key(self) -> str:
        if _missing_secret(self.audit_api_key):
            raise RuntimeError("AUDIT_API_KEY is required for API access")
        return self.audit_api_key

    @property
    def tm4j_enabled(self) -> bool:
        return bool(
            self.tm4j_base_url
            and not _missing_secret(self.tm4j_jwt)
            and self.tm4j_jira_project_id is not None
        )


@lru_cache
def get_settings() -> Settings:
    return Settings(
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://zephyr_user:zephyr_password@localhost:5432/zephyr_audit",
        ),
        zephyr_api_token=os.getenv("ZEPHYR_API_TOKEN"),
        zephyr_project_key=os.getenv("ZEPHYR_PROJECT_KEY", "").strip(),
        zephyr_parent_folder_id=_int_env("ZEPHYR_PARENT_FOLDER_ID"),
        zephyr_base_url=os.getenv("ZEPHYR_BASE_URL", "https://api.zephyrscale.smartbear.com/v2").rstrip("/"),
        zephyr_fetch_test_steps=_bool_env("ZEPHYR_FETCH_TEST_STEPS", True),
        audit_api_key=os.getenv("AUDIT_API_KEY"),
        cors_origins=_csv_env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
        api_max_limit=_int_env("API_MAX_LIMIT", 1000) or 1000,
        poll_page_size=_int_env("POLL_PAGE_SIZE", 100) or 100,
        poll_step_concurrency=_int_env("POLL_STEP_CONCURRENCY", 5) or 5,
        request_timeout_seconds=_float_env("REQUEST_TIMEOUT_SECONDS", 60.0),
        archive_status_names=tuple(name.lower() for name in _csv_env("ARCHIVE_STATUS_NAMES", "Archived,Deprecated")),
        zephyr_audit_endpoint_template=os.getenv("ZEPHYR_AUDIT_ENDPOINT_TEMPLATE") or None,
        jira_base_url=(os.getenv("JIRA_BASE_URL") or "").rstrip("/") or None,
        jira_user_email=os.getenv("JIRA_USER_EMAIL"),
        jira_api_token=os.getenv("JIRA_API_TOKEN"),
        slack_webhook_url=os.getenv("SLACK_WEBHOOK_URL"),
        alert_batch_size=_int_env("ALERT_BATCH_SIZE", 50) or 50,
        alert_max_retries=_int_env("ALERT_MAX_RETRIES", 3) or 3,
        alert_initial_delay_seconds=_float_env("ALERT_INITIAL_DELAY_SECONDS", 2.0),
        # Poller concurrency settings (previously hardcoded)
        folder_fetch_concurrency=_int_env("FOLDER_FETCH_CONCURRENCY", 20) or 20,
        test_step_fetch_concurrency=_int_env("TEST_STEP_FETCH_CONCURRENCY", 100) or 100,
        # API rate limiting
        rate_limit_per_minute=_int_env("RATE_LIMIT_PER_MINUTE", 120) or 120,
        # Retry settings
        api_retry_count=_int_env("API_RETRY_COUNT", 3) or 3,
        api_retry_delay_seconds=_float_env("API_RETRY_DELAY_SECONDS", 1.0),
        tm4j_base_url=(os.getenv("TM4J_BASE_URL") or "").rstrip("/") or None,
        tm4j_jwt=os.getenv("TM4J_JWT"),
        tm4j_jira_project_id=_int_env("TM4J_JIRA_PROJECT_ID"),
        tm4j_history_concurrency=_int_env("TM4J_HISTORY_CONCURRENCY", 50) or 50,
        stats_timezone=(os.getenv("STATS_TIMEZONE") or os.getenv("TZ") or "UTC").strip(),
    )