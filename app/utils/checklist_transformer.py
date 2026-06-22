import re
import html
from typing import List, Dict, Any, Optional

CURRENT_TRANSFORM_VERSION = 2

# Standard fallback configuration if DB seed is not loaded
DEFAULT_FILLER_VERBS = [
    "verify that", "check that", "ensure", "validate", "verify", 
    "check", "to verify", "to check", "to ensure", "assert that", "assert"
]

DEFAULT_GENERIC_WORDS = [
    "web", "functional", "regression", "sanity", "test cases", 
    "mobile", "android", "ios", "api", "integration", "test", "cases", "automated"
]


def clean_html(text: Optional[str]) -> str:
    """Helper to remove HTML tags and unescape entities."""
    if not text:
        return ""
    # Remove HTML tags
    cleaned = re.sub(r'<[^>]*>', ' ', text)
    # Unescape HTML entities (like &nbsp;, &lt;, &gt;, &amp;)
    cleaned = html.unescape(cleaned)
    # Collapse multiple whitespaces
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()


def clean_checklist_label(raw_name: str, filler_verbs: Optional[List[str]] = None) -> str:
    """
    Cleans raw test case name by stripping project IDs, tags, filler verbs, and trailing OS/browser noise.
    Processes sentences by extracting the primary logical clause before transitional words/conjunctions.
    Caps at 120 characters at word boundary, avoiding aggressive truncation.
    """
    if not raw_name or not raw_name.strip():
        return "Untitled checklist item"

    cleaned = raw_name.strip()

    # 1. Replace underscores with spaces and collapse spaces
    cleaned = cleaned.replace("_", " ")
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # 2. Strip leading test case IDs/brackets: e.g. TC-001_, TC_123_, [PROJ-T12], T42 -
    cleaned = re.sub(r'^\[[^\]]+\]\s*', '', cleaned)
    cleaned = re.sub(r'^(TC[-_]?\d+|[A-Z]+[-_]?T?\d+)\b\s*[-_:]*\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'^\d+\s*[-_:]\s*', '', cleaned)

    # 2.5 Strip JIRA keys: e.g. [JIRA-1234], PROJ-1234 -, JIRA-1234:
    cleaned = re.sub(r'\[[A-Z]+-\d+\]\s*', '', cleaned)
    cleaned = re.sub(r'\b[A-Z]+-\d+\b\s*[-_:]*\s*', '', cleaned)

    # 3. Strip tags in brackets or parentheses
    cleaned = re.sub(r'\[(regression|sanity|smoke|p\d|high|medium|low|prod|stage)\]', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\((regression|sanity|smoke|p\d|high|medium|low|prod|stage)\)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # 4. Extract first logical clause before transitional words/punctuation
    # Divide sentences by comma-then, semicolon, dash, or conjunctions like "so that", "in order to"
    # only if the first part is at least 8 characters long to prevent overly aggressive truncation.
    # Note: We do NOT split on conditional words like "if", "unless", "because", or "depending on"
    # as they represent critical test conditions.
    dividers = [
        r'\s*;\s*',
        r'\s+-\s+',
        r'\s+–\s+',
        r'\s+—\s+',
        r'\bso\s+that\b',
        r'\bin\s+order\s+to\b',
    ]
    pattern = '|'.join(dividers)
    parts = re.split(pattern, cleaned, flags=re.IGNORECASE)
    if parts and len(parts[0].strip()) >= 8:
        cleaned = parts[0].strip()

    # 5. Strip filler verbs and common action-inhibiting phrases
    extended_fillers = [
        "verify that user is able to", "verify that user can", "verify that",
        "check that user is able to", "check that user can", "check that",
        "ensure that user is able to", "ensure that user can", "ensure that",
        "validate that user is able to", "validate that user can", "validate that",
        "assert that user is able to", "assert that user can", "assert that",
        "confirm that user is able to", "confirm that user can", "confirm that",
        "verify if", "check if", "to verify if", "to check if", "to ensure that",
        "validate if", "assert if", "confirm if", "confirm", "verify", "check", 
        "ensure", "validate", "assert", "to verify", "to check", "to ensure",
        "should be able to", "user is able to", "user can", "is able to", 
        "are able to", "be able to", "ability to", "verify the ability of"
    ]
    
    verbs = filler_verbs if filler_verbs is not None else extended_fillers
    if verbs:
        sorted_verbs = sorted(verbs, key=len, reverse=True)
        for verb in sorted_verbs:
            escaped_verb = re.escape(verb)
            cleaned = re.sub(r'^(?:' + escaped_verb + r')\b\s*', '', cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r'^(?:to\s+)?(?:' + escaped_verb + r')\b\s*', '', cleaned, flags=re.IGNORECASE)

    # 6. Strip trailing browser/OS noise (only matching the noise itself, not trailing actions)
    cleaned = re.sub(r'\s+(?:on|in)\s+(?:chrome|safari|firefox|edge|ie|android|ios|web|mobile|desktop|windows|mac|linux)(?:\s+(?:v?\d+(?:\.\d+)*|macos|windows|linux|os|browser|devices?))*\b', '', cleaned, flags=re.IGNORECASE)

    # 6.5 Smart replacements for mathematical/comparative phrases
    cleaned = re.sub(r'\bgreater\s+than\s+or\s+equal\s+to\b', '>=', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bless\s+than\s+or\s+equal\s+to\b', '<=', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bgreater\s+than\b', '>', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bless\s+than\b', '<', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bequal\s+to\b', '=', cleaned, flags=re.IGNORECASE)

    # 7. Strip leading articles: "a ", "an ", "the "
    cleaned = re.sub(r'^(?:the|a|an)\s+', '', cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # Fallback to raw if we stripped away too much
    if len(cleaned) < 4:
        raw_fallback = re.sub(r'^\[[^\]]+\]\s*', '', raw_name.strip())
        cleaned = raw_fallback.strip()[:120]
        if not cleaned:
            return raw_name.strip()[:120]

    # Truncate to 120 chars at word boundary, back off at most 30 characters
    if len(cleaned) > 120:
        truncated = cleaned[:120]
        last_space = truncated.rfind(' ', 90)
        if last_space != -1:
            cleaned = truncated[:last_space].strip()
        else:
            cleaned = truncated.strip()

    # 7.5 Capitalize standard acronyms properly
    acronyms = {
        r'\binr\b': 'INR',
        r'\bapi\b': 'API',
        r'\bios\b': 'iOS',
        r'\bcsv\b': 'CSV',
        r'\burl\b': 'URL',
        r'\bpdf\b': 'PDF',
        r'\bhtml\b': 'HTML',
        r'\bjira\b': 'JIRA',
        r'\bid\b': 'ID',
        r'\bui\b': 'UI',
        r'\bux\b': 'UX',
    }
    for pattern, repl in acronyms.items():
        cleaned = re.sub(pattern, repl, cleaned, flags=re.IGNORECASE)

    # Clean up double spaces or trailing punctuation
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = re.sub(r'[.,;:-]+$', '', cleaned).strip()

    # Ensure sentence-case (first letter uppercase)
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]

    return cleaned


def extract_module(folder_path: Optional[str], generic_words: Optional[List[str]] = None) -> str:
    """
    Parses folder path, skips generic folder words, and returns last 2 meaningful segments.
    Falls back to last segment, or "Uncategorized".
    """
    if not folder_path or not folder_path.strip():
        return "Uncategorized"

    # Split by common separators: >, /, or ›
    segments = [s.strip() for s in re.split(r'[>/›]', folder_path) if s.strip()]
    if not segments:
        return "Uncategorized"

    skip_words = set(w.lower() for w in (generic_words if generic_words is not None else DEFAULT_GENERIC_WORDS))
    meaningful = [s for s in segments if s.lower() not in skip_words]

    if not meaningful:
        # Fall back to the very last segment of the original path if everything was filtered out
        return segments[-1] if segments else "Uncategorized"

    # Return last 2 segments joined by ' › '
    if len(meaningful) >= 2:
        return " › ".join(meaningful[-2:])
    return meaningful[-1]


def extract_verification_points(steps_json: Optional[List[Dict[str, Any]]]) -> List[str]:
    """
    Extracts up to 10 unique verification points from test case steps.
    Each step can be nested under 'inline' or flat.
    """
    if not steps_json:
        return []

    points = []
    seen = set()

    for step in steps_json:
        if not isinstance(step, dict):
            continue

        # Zephyr sometimes wraps step data under an "inline" dictionary
        step_data = step.get("inline") if "inline" in step and isinstance(step["inline"], dict) else step

        desc = clean_html(step_data.get("description", ""))
        expected = clean_html(step_data.get("expectedResult", ""))

        if not desc and not expected:
            continue

        # Combine description and expected result
        if desc and expected:
            point = f"{desc} → {expected}"
        elif desc:
            point = desc
        else:
            point = expected

        # Remove step numbers if any (e.g. "1. Open app" -> "Open app")
        point = re.sub(r'^\d+\s*[-:.)]\s*', '', point).strip()

        if not point:
            continue

        point_lower = point.lower()
        if point_lower not in seen:
            seen.add(point_lower)
            points.append(point)

        if len(points) == 10:
            break

    return points


def extract_precondition(raw_snapshot: Optional[Dict[str, Any]]) -> Optional[str]:
    """
    Pulls objective or precondition field from raw_snapshot, cleans HTML, and caps at 300 characters.
    """
    if not raw_snapshot or not isinstance(raw_snapshot, dict):
        return None

    raw_precond = raw_snapshot.get("precondition") or raw_snapshot.get("objective")
    if not raw_precond or not isinstance(raw_precond, str):
        return None

    cleaned = clean_html(raw_precond)
    if not cleaned:
        return None

    # Cap at 300 characters
    if len(cleaned) > 300:
        return cleaned[:297] + "..."
    return cleaned
