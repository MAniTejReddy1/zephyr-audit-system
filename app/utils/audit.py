# audit_utils.py
from __future__ import annotations

import hashlib
import json
from typing import Any

# Fields historically considered significant for change detection.
# The snapshot builder now includes every non-volatile field, but keeps this
# list to process common user-facing fields first for stable diffs.
TRACKED_FIELDS = (
    "key", "name", "status", "priority", "folder", "objective",
    "precondition", "description", "labels", "customFields",
    "testScript", "steps", "testSteps", "script", "parameters",
    "owner", "ownerAccountId", "ownerName", "assignee", "assigneeAccountId",
)

# Keys to redact due to sensitivity
SENSITIVE_MARKERS = (
    "token", "password", "secret", "authorization", "cookie",
    "api_key", "apikey",
)

# Keys to ignore as they are always different (timestamps, links)
VOLATILE_FIELDS = {
    "_links", "links", "self", "href", "createdOn", "createdAt",
    "updatedOn", "updatedAt", "lastModifiedOn", "lastModifiedAt",
    "webLink", "id",
}

def sanitize_for_storage(value: Any) -> Any:
    """Recursively remove volatile fields and redact sensitive data."""
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            key_l = str(key).lower()
            if any(marker in key_l for marker in SENSITIVE_MARKERS):
                clean[key] = "[REDACTED]"
            elif key in VOLATILE_FIELDS:
                continue
            else:
                clean[key] = sanitize_for_storage(item)
        return clean
    if isinstance(value, list):
        return [sanitize_for_storage(item) for item in value]
    return value

def get_meaningful_fields(snapshot: dict[str, Any] | None) -> dict[str, Any]:
    """Extract only the fields relevant for comparison, sanitizing them."""
    if not snapshot:
        return {}

    meaningful = {}
    for key, value in snapshot.items():
        if key in VOLATILE_FIELDS:
            continue

        # Recursively sanitize to strip nested volatile fields
        sanitized_value = sanitize_for_storage(value)

        # Normalize complex objects to their name/ID for stable comparison
        if isinstance(sanitized_value, dict) and 'name' in sanitized_value:
            meaningful[key] = sanitized_value['name']
        elif isinstance(sanitized_value, dict) and 'id' in sanitized_value:
            meaningful[key] = sanitized_value['id']
        else:
            meaningful[key] = sanitized_value

    return meaningful

def _normalize_entity(value: Any) -> Any:
    """Normalize a dictionary to its core identifiers for stable hashing."""
    if isinstance(value, dict):
        # Prioritize name, then key, then id for stability
        for key in ("name", "key", "id"):
            if key in value:
                return {key: sanitize_for_storage(value[key])}
        return sanitize_for_storage(value)
    return sanitize_for_storage(value)

def _normalize_labels(value: Any) -> Any:
    """Sort labels to ensure consistent order for hashing."""
    if not value:
        return []
    if isinstance(value, list):
        # Sort list of strings or simple objects
        try:
            return sorted(sanitize_for_storage(value), key=lambda item: json.dumps(item, sort_keys=True, default=str))
        except TypeError:
            return sanitize_for_storage(value) # Fallback for un-sortable complex items
    return sanitize_for_storage(value)

def build_audit_snapshot(case_data: dict[str, Any], folder_path: str | None, test_steps: Any = None) -> dict[str, Any]:
    """Create a consistent, comparable snapshot of a test case."""
    snapshot: dict[str, Any] = {}
    fields = list(TRACKED_FIELDS)
    fields.extend(sorted(key for key in case_data.keys() if key not in TRACKED_FIELDS))

    for field in fields:
        if field not in case_data:
            continue
        if field in VOLATILE_FIELDS:
            continue

        value = case_data[field]
        if field in {"status", "priority", "folder"}:
            snapshot[field] = _normalize_entity(value)
        elif field == "labels":
            snapshot[field] = _normalize_labels(value)
        else:
            snapshot[field] = sanitize_for_storage(value)

    if folder_path is not None:
        snapshot["folderPath"] = folder_path
    if test_steps is not None:
        snapshot["testSteps"] = sanitize_for_storage(test_steps)

    return snapshot

def hash_data(data: dict[str, Any]) -> str:
    """Generate a SHA-256 hash of a dictionary for quick change detection."""
    payload = json.dumps(data, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

def diff_changed_fields(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[str]:
    """Identify keys that have changed between two dictionaries."""
    before = get_meaningful_fields(before or {})
    after = get_meaningful_fields(after or {})

    changed = []
    all_keys = sorted(set(before.keys()) | set(after.keys()))

    for key in all_keys:
        # Use JSON string comparison for nested objects
        before_val = json.dumps(before.get(key), sort_keys=True, default=str)
        after_val = json.dumps(after.get(key), sort_keys=True, default=str)

        if before_val != after_val:
            changed.append(key)

    return changed

def extract_user(data: dict[str, Any], *field_names: str) -> tuple[str | None, str | None]:
    """Extract user account ID and name from a dictionary."""
    for field in field_names:
        value = data.get(field)
        if isinstance(value, dict):
            account = value.get("accountId") or value.get("userKey") or value.get("id") or value.get("key")
            name = value.get("displayName") or value.get("name") or value.get("emailAddress")
            if account or name:
                return str(account) if account else None, str(name) if name else None
        elif isinstance(value, str) and value:
            # Handle flat string fields (e.g. "createdBy": "JIRAUSER1000")
            return value, None
    return None, None

def _is_valid_display_name(name: str | None) -> bool:
    """Check if a display name looks like a real name rather than an account ID."""
    if not name: return False
    if ':' in name: return False
    if len(name) == 24 and all(c in '0123456789abcdef' for c in name.lower()): return False
    if len(name) == 36 and name.count('-') == 4: return False
    return True
