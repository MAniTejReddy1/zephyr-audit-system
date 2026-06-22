import re
import html
from html.parser import HTMLParser
from typing import Optional, List, Dict, Any, Union

CURRENT_TRANSFORM_VERSION = 2

# ── configurable defaults ──────────────────────────────────────────────
DEFAULT_FILLER_VERBS: List[str] = [
    r'verify\s+that\s+(user\s+is\s+able\s+to\s+)?',
    r'verify\s+(user\s+is\s+able\s+to\s+)?',
    r'check\s+(?:if|that|whether)\s+',
    r'ensure\s+(?:that\s+)?',
    r'validate\s+(?:that\s+)?',
    r'assert\s+(?:that\s+)?',
    r'confirm\s+(?:that\s+)?',
    r'test\s+(?:that\s+|whether\s+|if\s+)?',
    # Standalone verbs and optional leading "to" (plain strings to allow boundary matching)
    'verify',
    'to verify',
    'check',
    'to check',
    'ensure',
    'to ensure',
    'validate',
    'to validate',
    'assert',
    'to assert',
    'confirm',
    'to confirm',
    'given',
]

DEFAULT_NOISE_SEGMENTS: set[str] = {
    'web', 'functional', 'regression', 'sanity', 'smoke',
    'test cases', 'test case', 'tests', 'suite', 'misc',
    'general', 'other', 'common', 'all', 'master',
}

# Keep this alias/definition for backwards compatibility of generic_words / noise_words
DEFAULT_GENERIC_WORDS: List[str] = [
    'web', 'functional', 'regression', 'sanity', 'test cases',
    'mobile', 'android', 'ios', 'api', 'integration', 'test', 'cases', 'automated'
]

ACRONYMS: set[str] = {
    'api', 'ios', 'csv', 'ui', 'ux', 'url', 'otp', 'kyc', 'p2p',
    'tls', 'ssl', 'http', 'https', 'id', 'ids', 'sdk', 'json', 'xml',
    'usdt', 'btc', 'eth', 'inr', 'tpe', 'coindcx'
}

MAX_LABEL_LEN: int = 120
MIN_LABEL_LEN: int = 4
MAX_PRECOND_LEN: int = 300
MAX_VERIFICATION_POINTS: int = 10

# ── private helpers ────────────────────────────────────────────────────
class _StripHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts = []
    def handle_data(self, data):
        self._parts.append(data)
    def get_text(self):
        return ' '.join(self._parts).strip()

def _strip_html(raw: str) -> str:
    parser = _StripHTML()
    parser.feed(html.unescape(raw or ''))
    return re.sub(r'\s+', ' ', parser.get_text()).strip()

def clean_html(text: Optional[str]) -> str:
    """Helper to remove HTML tags and unescape entities. (backwards-compatible alias)"""
    return _strip_html(text or '')

def _fix_acronyms(text: str) -> str:
    def replacer(m):
        word = m.group(0)
        if word.lower() == 'ios':
            return 'iOS'
        return word.upper() if word.lower() in ACRONYMS else word
    return re.sub(r'\b[a-zA-Z]+\b', replacer, text)

def _build_filler_pattern(verbs: List[str]) -> re.Pattern:
    if not verbs:
        return re.compile(r'^$')
    
    processed = []
    for v in verbs:
        # Check if it's already a regex pattern
        if any(c in v for c in ('\\', '(', ')', '?', '+', '*', '|')):
            processed.append(v)
        else:
            escaped = re.escape(v.strip())
            pattern = re.sub(r'\\\s+', r'\\s+', escaped)
            processed.append(pattern + r'(?:\b|\s+)')
    
    processed = sorted(processed, key=len, reverse=True)
    return re.compile(r'^(?:' + '|'.join(processed) + r')', re.IGNORECASE)

STEP_NUM_RE = re.compile(r'^\d+[\.\)]\s*')

# ── public API ─────────────────────────────────────────────────────────
def clean_checklist_label(
    raw_name: str,
    filler_verbs: Optional[List[str]] = None,
) -> str:
    if not raw_name or not isinstance(raw_name, str) or not raw_name.strip():
        return "Untitled checklist item"

    # Step 1 — Whitespace normalisation
    name = raw_name.strip()
    name = name.replace('_', ' ')
    name = re.sub(r'\s+', ' ', name)

    # Step 2 — Strip leading IDs and bracket-wrapped keys
    # Leading/trailing bracket keys: [PROJ-T12], [JIRA-123]
    name = re.sub(r'^\[[A-Z]+-[A-Z]?\d+\]\s*', '', name, flags=re.IGNORECASE)

    # Leading TC-001_, T001_, etc. (support hyphen between prefix and digits, and space/underscore/hyphen separator after)
    name = re.sub(r'^[A-Z]{0,6}[-_]?\d+[-_\s]*', '', name, flags=re.IGNORECASE)

    # Embedded JIRA keys mid-string: [JIRA-1234] or PROJ-1234 -
    name = re.sub(r'\[[A-Z]+-\d+\]', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\b[A-Z]{2,6}-\d+\s*-\s*', '', name)
    name = name.strip()

    # Step 3 — Strip tag tokens
    try:
        from app.config import get_settings
        tag_words = get_settings().tag_words
    except Exception:
        tag_words = ("regression", "smoke", "sanity", "p0", "p1", "p2", "p3", "prod", "staging", "dev", "qa", "wip", "skip", "automation")
    
    if tag_words:
        tag_pattern_str = "|".join(w.strip() if any(c in w for c in "[]()*+?|") else re.escape(w.strip()) for w in tag_words)
        name = re.sub(r'\[(?:' + tag_pattern_str + r')\]', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\((?:' + tag_pattern_str + r')\)', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s+', ' ', name).strip()

    # Step 3.5 — Gherkin assertion extraction (only for Gherkin test cases starting with Given/When)
    if name.lower().startswith("given ") or name.lower().startswith("when "):
        then_match = re.search(r'\b(?:then|should)\b\s+(.*)', name, re.IGNORECASE)
        if then_match:
            name = then_match.group(1).strip()
        else:
            when_match = re.search(r'\b(?:when)\b\s+(.*)', name, re.IGNORECASE)
            if when_match:
                name = when_match.group(1).strip()

    # Step 4 — Logical clause extraction (first primary clause only)
    CLAUSE_SPLIT_RE = re.compile(
        r'\s*(?:;|'
        r'\s+-\s+(?=[a-z])|'    # bare " - " only when followed by lowercase (avoids splitting "Login - API")
        r'\bso\s+that\b|'
        r'\bin\s+order\s+to\b|'
        r'\bso\s+as\s+to\b'
        r').*$',
        re.IGNORECASE | re.DOTALL
    )
    name = CLAUSE_SPLIT_RE.sub('', name).strip()

    # Step 5 — Filler verb removal
    verbs_list = filler_verbs if filler_verbs is not None else DEFAULT_FILLER_VERBS
    filler_pattern = _build_filler_pattern(verbs_list)
    name = filler_pattern.sub('', name).strip()

    # Step 6 — Trailing environment noise
    ENV_NOISE_RE = re.compile(
        r'\s+(?:on|in|via|using)\s+'
        r'(?:chrome|firefox|safari|edge|ie|ie\s*\d+|'
        r'ios(?:\s*v?\d+)?|android(?:\s*v?\d+)?|'
        r'desktop\s+browser|mobile\s+browser|'
        r'windows|mac(?:os)?|linux)'
        r'(?:\s+(?:v?\d+(?:\.\d+)*|macos|windows|linux|os|browser|devices?))*\s*$',
        re.IGNORECASE
    )
    name = ENV_NOISE_RE.sub('', name).strip()

    # Step 7 — Math/comparison symbol substitution
    MATH_SUBS = [
        (r'\bgreater\s+than\s+or\s+equal\s+to\b', '>='),
        (r'\bless\s+than\s+or\s+equal\s+to\b',    '<='),
        (r'\bgreater\s+than\b',                    '>'),
        (r'\bless\s+than\b',                       '<'),
        (r'\bnot\s+equal\s+to\b',                  '!='),
        (r'\bequal\s+to\b',                        '='),
    ]
    for pattern, replacement in MATH_SUBS:
        name = re.sub(pattern, replacement, name, flags=re.IGNORECASE)

    # Step 8 — Leading article removal
    name = re.sub(r'^(?:a|an|the)\s+', '', name, flags=re.IGNORECASE)

    # Step 9 — Truncation with safety fallback
    MAX_LEN = MAX_LABEL_LEN
    MIN_LEN = MIN_LABEL_LEN

    if len(name) > MAX_LEN:
        truncated = name[:MAX_LEN].rsplit(' ', 1)[0]  # cut at word boundary
        name = truncated

    # Safety fallback: if cleaning over-stripped, revert to raw minus leading ID
    if len(name.strip()) < MIN_LEN:
        # Re-run only steps 1+2 on raw_name and use that
        fallback = re.sub(r'^[A-Z]{0,6}[-_]?\d+[-_\s]*', '', raw_name, flags=re.IGNORECASE).strip()
        fallback = re.sub(r'^\[[A-Z]+-[A-Z]?\d+\]\s*', '', fallback, flags=re.IGNORECASE).strip()
        name = fallback[:MAX_LEN]
        if not name.strip():
            name = raw_name.strip()[:MAX_LEN]

    # Step 10 — Acronym fix + sentence case
    # Sentence case: capitalise first char only
    name = name[0].upper() + name[1:] if name else name
    name = _fix_acronyms(name)

    # Clean up double spaces or trailing punctuation (backwards compatibility logic)
    name = re.sub(r'\s+', ' ', name).strip()
    name = re.sub(r'[.,;:-]+$', '', name).strip()

    return name

def extract_module(
    folder_path: Optional[str],
    noise_words: Optional[Union[set[str], List[str]]] = None,
) -> str:
    if not folder_path or not isinstance(folder_path, str):
        return "Uncategorized"

    if noise_words is not None:
        noise = {w.lower() for w in noise_words}
    else:
        noise = DEFAULT_NOISE_SEGMENTS
        
    separators = re.compile(r'\s*[>/›\\]\s*')
    segments = [s.strip() for s in separators.split(folder_path) if s.strip()]
    meaningful = [s for s in segments if s.lower() not in noise]

    if not meaningful:
        # Fallback: raw last segment
        return segments[-1] if segments else "Uncategorized"

    # Return last two meaningful segments
    return ' › '.join(meaningful[-2:]) if len(meaningful) >= 2 else meaningful[-1]

def extract_verification_points(steps: Optional[List[Any]]) -> List[str]:
    if not steps:
        return []

    seen: set[str] = set()
    points: List[str] = []

    for step in steps:
        # Handle nested inline dict
        if isinstance(step, dict):
            step = step.get('inline', step)
        if isinstance(step, dict):
            desc_raw = step.get('description') or step.get('step') or ''
            expected_raw = step.get('expectedResult') or step.get('expected_result') or ''
            desc = _strip_html(str(desc_raw))
            expected = _strip_html(str(expected_raw))
        else:
            desc = _strip_html(str(step))
            expected = ''

        desc = STEP_NUM_RE.sub('', desc).strip()
        expected = STEP_NUM_RE.sub('', expected).strip()

        if desc and expected:
            point = f"{desc} → {expected}"
        elif desc:
            point = desc
        elif expected:
            point = expected
        else:
            continue

        key = point.lower()
        if key not in seen:
            seen.add(key)
            points.append(point)
            if len(points) == MAX_VERIFICATION_POINTS:
                break

    return points

def extract_precondition(raw_tc: Optional[Dict[str, Any]]) -> Optional[str]:
    if not raw_tc or not isinstance(raw_tc, dict):
        return None

    raw = raw_tc.get('precondition') or raw_tc.get('objective') or ''
    cleaned = _strip_html(str(raw))
    if not cleaned:
        return None
    if len(cleaned) > MAX_PRECOND_LEN:
        # Truncate at word boundary within MAX_PRECOND_LEN - 1 to make space for 1-char ellipsis
        limit = MAX_PRECOND_LEN - 1
        truncated = cleaned[:limit]
        if ' ' in truncated:
            truncated = truncated.rsplit(' ', 1)[0]
        return truncated + '…'
    return cleaned
