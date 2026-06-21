import { useState, useMemo, useCallback, useEffect, useRef, Component, createContext, useContext } from "react";
import {
  History, Folder, FolderOpen, Activity, Settings, Search, FileText,
  ArrowRight, ChevronRight, ChevronDown, ChevronUp, RotateCcw, X,
  SlidersHorizontal, Database, AlertCircle, GitBranch, Move, Trash2,
  User, Clock, Calendar, RefreshCw, Eye, EyeOff, GitCommit, Plus, Minus,
  ChevronLeft, Users, Layers,
  BarChart3, TrendingUp, TrendingDown,
  CheckCircle2, XCircle, Info, AlertTriangle, Hash, List,
  Sparkles, Sun, Moon, ListChecks, Target, ExternalLink
} from "lucide-react";
import QAChecklistPage from "./pages/QAChecklistPage";

/* ═══════════════════════════════════════════════════════════════════
   THEME SYSTEM - Dark & Light Mode Support
═══════════════════════════════════════════════════════════════════ */
const darkTheme = {
  // Backgrounds - Rich dark tones
  bg: '#0a0e14', bgAlt: '#070a0f', bgSurface: '#12171f', sidebar: '#0d1117',
  card: '#151b23', cardHover: '#1a222c', cardActive: '#1f2937',

  // Borders (bumped contrast vs original #2d3748 for visibility on dark bg)
  border: '#323c4d', borderLight: '#222b39', borderHover: '#516179',

  // Text
  text: '#f0f6fc', textSecondary: '#c9d1d9', textMuted: '#8b99a6', textDim: '#677685', textSubtle: '#7a8694',

  // Accent Colors - Vibrant
  blue: '#60a5fa', blueLight: '#93c5fd', blueDark: '#3b82f6', blueDim: 'rgba(96,165,250,.15)',
  green: '#10B981', greenLight: '#86efac', greenDark: '#059669', greenDim: 'rgba(74,222,128,.12)',
  red: '#F43F5E', redLight: '#fca5a5', redDark: '#DC2626', redDim: 'rgba(248,113,113,.12)',
  yellow: '#fbbf24', yellowLight: '#fcd34d', yellowDark: '#f59e0b', yellowDim: 'rgba(251,191,36,.12)',
  purple: '#a78bfa', purpleLight: '#c4b5fd', purpleDark: '#8b5cf6', purpleDim: 'rgba(167,139,250,.12)',
  orange: '#fb923c', orangeLight: '#fdba74', orangeDark: '#f97316', orangeDim: 'rgba(251,146,60,.12)',
  teal: '#2dd4bf', tealDim: 'rgba(45,212,191,.12)',
  cyan: '#22d3ee', pink: '#f472b6', pinkDim: 'rgba(244,114,182,.12)',

  // Gradients
  gradBlue: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
  gradGreen: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
  gradPurple: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
  gradOrange: 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)',
  gradPink: 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)',

  // Diff colors
  diffAdd: '#166534', diffAddBg: 'rgba(74,222,128,.1)',
  diffDel: '#991b1b', diffDelBg: 'rgba(248,113,113,.1)',
};

const lightTheme = {
  // Backgrounds - Clean light tones
  bg: '#f8fafc', bgAlt: '#f1f5f9', bgSurface: '#ffffff', sidebar: '#f8fafc',
  card: '#ffffff', cardHover: '#f8fafc', cardActive: '#f1f5f9',

  // Borders
  border: '#d8e0ea', borderLight: '#eef2f7', borderHover: '#b6c2d2',

  // Text
  text: '#1e293b', textSecondary: '#475569', textMuted: '#5b6678', textDim: '#94a3b8', textSubtle: '#64748b',

  // Accent Colors - Slightly darker for light mode
  blue: '#2563eb', blueLight: '#60a5fa', blueDark: '#1d4ed8', blueDim: 'rgba(37,99,235,.1)',
  green: '#16a34a', greenLight: '#4ade80', greenDark: '#15803d', greenDim: 'rgba(22,163,74,.1)',
  red: '#dc2626', redLight: '#f87171', redDark: '#b91c1c', redDim: 'rgba(220,38,38,.1)',
  yellow: '#d97706', yellowLight: '#fbbf24', yellowDark: '#b45309', yellowDim: 'rgba(217,119,6,.1)',
  purple: '#7c3aed', purpleLight: '#a78bfa', purpleDark: '#6d28d9', purpleDim: 'rgba(124,58,237,.1)',
  orange: '#ea580c', orangeLight: '#fb923c', orangeDark: '#c2410c', orangeDim: 'rgba(234,88,12,.1)',
  teal: '#0d9488', tealDim: 'rgba(13,148,136,.1)',
  cyan: '#0891b2', pink: '#db2777', pinkDim: 'rgba(219,39,119,.1)',

  // Gradients
  gradBlue: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  gradGreen: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  gradPurple: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  gradOrange: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  gradPink: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',

  // Diff colors
  diffAdd: '#166534', diffAddBg: 'rgba(34,197,94,.15)',
  diffDel: '#991b1b', diffDelBg: 'rgba(239,68,68,.15)',
};

// Theme context
const ThemeContext = createContext({ theme: darkTheme, isDark: true, toggleTheme: () => {} });
const useTheme = () => useContext(ThemeContext);

// ── Reactive theme accessor ──────────────────────────────────────────
// `activeTheme` is swapped by ThemeProvider during render. `T` is a Proxy, so
// every `T.x` read resolves to the CURRENT theme at access time. This removes
// the previous "mutable global with frozen snapshots" problem: there are no
// stale color closures, and switching themes updates every consumer (including
// GS, ACT, selectStyle/inputStyle) because they all read through the Proxy.
let activeTheme = darkTheme;
const setActiveTheme = (theme) => { activeTheme = theme; };
const T = new Proxy({}, { get: (_t, prop) => activeTheme[prop] });

// Built fresh per call so action styling tracks the active theme (no frozen colors).
const actInfo = () => ({
  CREATED: { c: T.green, bg: T.greenDim, label: 'Created', icon: Plus, gradient: T.gradGreen, glyph: '+' },
  UPDATED: { c: T.yellow, bg: T.yellowDim, label: 'Updated', icon: GitCommit, gradient: T.gradOrange, glyph: '~' },
  MOVED: { c: T.blue, bg: T.blueDim, label: 'Moved Out', icon: Move, gradient: T.gradBlue, glyph: '>' },
  MOVED_IN: { c: T.teal, bg: T.tealDim, label: 'Moved In', icon: RefreshCw, gradient: T.gradGreen, glyph: '<' },
  ARCHIVED: { c: T.orange, bg: T.orangeDim, label: 'Archived', icon: AlertTriangle, gradient: T.gradOrange, glyph: '!' },
  RESTORED: { c: T.green, bg: T.greenDim, label: 'Restored', icon: RefreshCw, gradient: T.gradGreen, glyph: '<' },
  DELETED: { c: T.red, bg: T.redDim, label: 'Deleted', icon: Trash2, gradient: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)', glyph: 'x' },
});

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const API_KEY = import.meta.env.VITE_AUDIT_API_KEY || '';
const POLLS_PAGE_SIZE = 10;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

const isLegacyScopeReturn = (log) => log?.action === 'RESTORED' && (log.changed_fields || []).includes('folderPath') && !log.folder_before;
const isScopeReturn = (log) => log?.action === 'MOVED_IN' || isLegacyScopeReturn(log);
const displayActionKey = (log) => isScopeReturn(log) ? 'MOVED_IN' : log?.action;
const actionConfig = (logOrAction) => {
  const key = typeof logOrAction === 'string' ? logOrAction : displayActionKey(logOrAction);
  const map = actInfo();
  return map[key] || map.UPDATED;
};

/** Map `/api/polls` audit_action parameter to PollChangesPanel display filter key */
function auditApiActionToDisplayPreset(apiAction) {
  if (!apiAction || apiAction === 'ALL') return null;
  const u = String(apiAction).toUpperCase();
  if (u === 'MOVED_OUT') return 'MOVED';
  if (u === 'MOVED_IN') return 'MOVED_IN';
  return u;
}

/* ── Formatting & display helpers (unified across the app) ── */
const pluralize = (n, singular, plural) =>
    `${Number(n || 0).toLocaleString()} ${Number(n) === 1 ? singular : (plural || `${singular}s`)}`;

// Newline / tab as char codes so these literals can't be corrupted by
// copy-paste tools that turn escape sequences into real line breaks.
const NEWLINE = String.fromCharCode(10);
const TABCH = String.fromCharCode(9);

const fmtDate = (value, mode = 'card') => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  if (mode === 'detail') return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (mode === 'time') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (mode === 'short') return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  // 'card' — minute precision, no seconds (reduces noise on dense lists)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const relativeTime = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/**
 * Honest delta rendering. The backend emits exactly 100 when the prior period
 * had zero activity (a "from-zero" growth, not a real +100%). We surface that
 * as "new this period" instead of a misleading "+100% vs prior".
 */
function describeDelta(deltaPct) {
  if (typeof deltaPct !== 'number' || Number.isNaN(deltaPct)) {
    return { label: 'no prior data', tone: 'neutral', kind: 'none' };
  }
  if (deltaPct === 0) return { label: 'no change vs prior', tone: 'neutral', kind: 'flat' };
  if (deltaPct === 100) return { label: 'new this period', tone: 'up', kind: 'new' };
  if (deltaPct > 0) return { label: `+${deltaPct}% vs prior`, tone: 'up', kind: 'up' };
  return { label: `${deltaPct}% vs prior`, tone: 'down', kind: 'down' };
}

const isUnknownActor = (name) =>
    !name || /^(unknown|unassigned|unknown user|unknown modifier|system|u)$/i.test(String(name).trim());

const isAbortError = (e) => e?.name === 'AbortError';

const apiFetch = async (path, options = {}) => {
  const headers = { ...options.headers };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

/**
 * Persisted UI state.
 *  - shared:false (default) → sessionStorage, per-tab/ephemeral.
 *  - shared:true            → localStorage + cross-tab sync via the `storage`
 *                             event (sessionStorage cannot sync across tabs).
 */
const usePersistentState = (key, defaultValue, { shared = false } = {}) => {
  const store = shared && typeof localStorage !== 'undefined' ? localStorage : sessionStorage;
  const [value, setValue] = useState(() => {
    try {
      const stored = store.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch { return defaultValue; }
  });

  const setStoredValue = useCallback((next) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try { store.setItem(key, JSON.stringify(resolved)); } catch (e) { console.error(e) }
      return resolved;
    });
  }, [key, store]);

  // Cross-tab sync (only meaningful for localStorage-backed shared state).
  useEffect(() => {
    if (!shared) return undefined;
    const onStorage = (e) => {
      if (e.key !== key || e.newValue == null) return;
      try { setValue(JSON.parse(e.newValue)); } catch (e) { console.error(e) }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, shared]);

  return [value, setStoredValue];
};

// Backwards-compatible alias: ephemeral per-tab UI state.
const useSessionState = (key, defaultValue) => usePersistentState(key, defaultValue, { shared: false });

/** Matches a media query reactively (drives responsive layout). */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL STYLES - Enhanced animations, interactions & accessibility
═══════════════════════════════════════════════════════════════════ */
// Built per render (reads the Proxy `T`) so light/dark switches actually restyle
// the document — body bg, scrollbars, focus rings, etc.
function buildGS() {
  const t = T; // Capture proxy for use in template literal
  return `
  :root {
    --bg: ${t.bg}; --bg-alt: ${t.bgAlt}; --bg-surface: ${t.bgSurface}; --sidebar: ${t.sidebar};
    --card: ${t.card}; --card-hover: ${t.cardHover}; --card-active: ${t.cardActive};
    --border: ${t.border}; --border-light: ${t.borderLight}; --border-hover: ${t.borderHover};
    --text: ${t.text}; --text-secondary: ${t.textSecondary}; --text-muted: ${t.textMuted}; --text-dim: ${t.textDim};
    --blue: ${t.blue}; --blue-dim: ${t.blueDim};
    --green: ${t.green}; --green-dim: ${t.greenDim};
    --red: ${t.red}; --red-dim: ${t.redDim};
    --yellow: ${t.yellow}; --yellow-dim: ${t.yellowDim};
    --purple: ${t.purple}; --purple-dim: ${t.purpleDim};
    --grad-blue: ${t.gradBlue};
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${T.bg};color:${T.text};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
  ::-webkit-scrollbar-thumb:hover{background:${T.textDim}}
  button{cursor:pointer;font-family:inherit;transition:all .2s cubic-bezier(.4,0,.2,1)}
  input,select,textarea{font-family:inherit;transition:all .2s ease}
  input:focus,select:focus,textarea:focus{outline:none;border-color:${T.blue};box-shadow:0 0 0 3px ${T.blueDim}}

  /* a11y: visible keyboard focus ring on all interactive elements */
  button:focus-visible,[role="button"]:focus-visible,a:focus-visible,[tabindex]:focus-visible{
    outline:2px solid ${T.blue};outline-offset:2px;border-radius:8px
  }
  /* tabular figures so numeric columns line up */
  .num{font-variant-numeric:tabular-nums}

  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes glow{0%,100%{box-shadow:0 0 20px rgba(96,165,250,.3)}50%{box-shadow:0 0 30px rgba(96,165,250,.5)}}
  @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}

  .hover-lift:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.3)}
  .hover-glow:hover{box-shadow:0 0 20px rgba(96,165,250,.2)}
  .hover-scale:hover{transform:scale(1.02)}
  .coverage-card-btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.2);border-color:${T.border}!important}

  /* sidebar nav hover via class to avoid stuck states */
  .sb-nav-btn{display:flex;align-items:center;gap:10px;width:100%;border:none;text-align:left;transition:all .18s ease;cursor:pointer}
  .sb-nav-btn:not(.active):hover{background:${T.bgAlt}!important;color:${T.text}!important}

  /* pie arc hover via transform-box */
  .pie-arc{transition:fill .15s;transform-box:fill-box;transform-origin:center;transition:fill .15s,transform .15s}
  .pie-arc:hover{transform:scale(1.06)}

  /* activity row */
  .activity-row{display:flex;align-items:center;gap:9px;width:100%;border:none;text-align:left;color:inherit;transition:background .15s;cursor:pointer}
  .activity-row:hover{background:${T.cardHover}!important}
  .activity-row:hover .drill-caret{transform:translateX(2px);color:${T.text}!important}

  /* period & chip pills */
  .period-pill{flex:1;border:none;border-radius:7px;cursor:pointer;transition:all .15s;font-family:inherit}
  .period-pill:not(.active):hover{background:${T.borderHover}!important;color:${T.text}!important}
  .chip:not(.active):hover{border-color:${T.borderHover}!important;color:${T.text}!important}

  .poll-card:hover{border-color:${T.borderHover}}
  .poll-card.dimmed{opacity:.55}
  .poll-card.dimmed:hover{opacity:.8}

  .resize-handle{cursor:col-resize;user-select:none;touch-action:none}
  .resize-handle:hover{background:${T.blue}40}
  .resize-handle:active{background:${T.blue}60}
  .sidebar-metrics::-webkit-scrollbar{width:3px}
  .sidebar-metrics::-webkit-scrollbar-thumb{background:${T.borderHover};border-radius:2px}
  .sidebar-metrics::-webkit-scrollbar-track{background:transparent}

  @keyframes pulseDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.7}}

  /* Respect users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
  }

  /* Responsive: stack the multi-pane layouts on narrow viewports */
  @media (max-width:860px){
    .pane-row{flex-direction:column!important}
    .pane-row > .pane{width:100%!important;flex:1 1 auto!important}
    .hide-narrow{display:none!important}
  }
`;
}

/* ═══════════════════════════════════════════════════════════════════
   USER NAME RESOLVER - Maps account IDs to display names
═══════════════════════════════════════════════════════════════════ */
function createUserResolver(actors) {
  const accountToName = new Map();
  const partialIdToName = new Map();

  actors.forEach(a => {
    if (a.account_id && a.display_name) {
      const id = String(a.account_id);
      const name = String(a.display_name);
      accountToName.set(id, name);
      accountToName.set(id.toLowerCase(), name);
      if (id.includes(':')) {
        id.split(':').forEach(part => {
          if (part.length > 8) { partialIdToName.set(part, name); partialIdToName.set(part.toLowerCase(), name); }
        });
      }
      const uuidMatch = id.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      if (uuidMatch) {
        partialIdToName.set(uuidMatch[0], name);
        partialIdToName.set(uuidMatch[0].toLowerCase(), name);
      }
    }
  });

  const tryResolve = (value) => {
    if (!value) return null;
    const str = String(value);
    const strLower = str.toLowerCase();
    if (accountToName.has(str)) return accountToName.get(str);
    if (accountToName.has(strLower)) return accountToName.get(strLower);
    if (partialIdToName.has(str)) return partialIdToName.get(str);
    if (partialIdToName.has(strLower)) return partialIdToName.get(strLower);
    const uuidMatch = str.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    if (uuidMatch) {
      if (partialIdToName.has(uuidMatch[0])) return partialIdToName.get(uuidMatch[0]);
      if (partialIdToName.has(uuidMatch[0].toLowerCase())) return partialIdToName.get(uuidMatch[0].toLowerCase());
    }
    for (const [key, name] of accountToName.entries()) {
      if (str.includes(key) || key.includes(str)) return name;
    }
    return null;
  };

  const isValidName = (name) => {
    if (!name) return false;
    const str = String(name);
    if (str.match(/[a-f0-9]{8}-[a-f0-9]{4}/i)) return false;
    if (str.match(/^\d+:/)) return false;
    if (str.includes('@atlassian')) return false;
    if (str.length > 50) return false;
    return true;
  };

  return (actorNameOrValue, actorAccount) => {
    const actorName = actorAccount !== undefined ? actorNameOrValue : null;
    const singleValue = actorAccount === undefined ? actorNameOrValue : null;

    if (singleValue !== undefined && singleValue !== null) {
      if (!singleValue) return 'Unassigned';
      if (isValidName(singleValue)) return String(singleValue);
      const resolved = tryResolve(singleValue);
      if (resolved) return resolved;
      const str = String(singleValue);
      if (str.includes('@')) return str.split('@')[0];
      return 'Unknown User';
    }

    if (isValidName(actorName)) return String(actorName);
    if (actorAccount) { const r = tryResolve(actorAccount); if (r) return r; }
    if (actorName) { const r = tryResolve(actorName); if (r) return r; }
    if (!actorName && !actorAccount) return 'Unassigned';
    return 'Unknown User';
  };
}

/* ═══════════════════════════════════════════════════════════════════
   RESIZABLE PANEL HOOK
═══════════════════════════════════════════════════════════════════ */
function useResizable(initialWidth, minWidth = 200, maxWidth = 600) {
  const [width, setWidth] = useState(initialWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minWidth, maxWidth]);

  return { width, handleMouseDown };
}

/* ═══════════════════════════════════════════════════════════════════
   DATA HOOK
═══════════════════════════════════════════════════════════════════ */
function useAuditData() {
  const [polls, setPolls] = useState([]);
  const [pollTotal, setPollTotal] = useState(0);
  const [folders, setFolders] = useState([]);
  const [testCases, setTestCases] = useState({ items: [], total: 0 });
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState({ total_cases: 0, total_logs: 0, updates: 0, updates_today: 0, active_cases: 0, audit_events: 0, latest_poll_changes: 0, changes_today: 0, poll_runs: 0 });
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);

  const [statsPeriod, setStatsPeriod] = useState('7d');

  const fetchStats = useCallback(async (period) => {
    try {
      const p = period || statsPeriod || '7d';
      const data = await apiFetch(`/stats?period=${encodeURIComponent(p)}`);
      setStats(data || { total_cases: 0, total_logs: 0, updates: 0, updates_today: 0, active_cases: 0, audit_events: 0, latest_poll_changes: 0, changes_today: 0, poll_runs: 0, automation_coverage: {}, weekly_activity: [], contributors_week: [], weekly_window: {} });
    } catch (e) { console.error('fetchStats:', e); }
  }, [statsPeriod]);

  const fetchPolls = useCallback(async (filters = {}, paging = {}) => {
    try {
      const limit = paging.limit || POLLS_PAGE_SIZE;
      const offset = paging.offset || 0;
      const requestLimit = Math.max(100, limit + offset);
      let url = `/polls?limit=${requestLimit}&offset=0`;
      if (filters.folder) url += `&folder_path=${encodeURIComponent(filters.folder)}`;
      if (filters.actor) url += `&actor=${encodeURIComponent(filters.actor)}`;
      if (filters.from) url += `&from=${encodeURIComponent(filters.from)}`;
      if (filters.to) url += `&to=${encodeURIComponent(filters.to)}`;
      if (filters.audit_action) url += `&audit_action=${encodeURIComponent(filters.audit_action)}`;
      if (filters.zephyr_keys) url += `&zephyr_keys=${encodeURIComponent(filters.zephyr_keys)}`;
      const data = await apiFetch(url);
      const applyClientPage = (items, total) => {
        const numbered = items.map((poll, index) => ({
          ...poll,
          poll_number: poll.poll_number ?? Math.max(1, total - index),
        }));
        setPolls(numbered.slice(offset, offset + limit));
        setPollTotal(total);
      };
      if (Array.isArray(data)) {
        applyClientPage(data, data.length);
      } else {
        const items = Array.isArray(data?.items) ? data.items : [];
        applyClientPage(items, Number(data?.total || items.length));
      }
      await fetchStats();
    } catch (e) { console.error('fetchPolls:', e); }
  }, [fetchStats]);

  const fetchTestCases = useCallback(async (folderId, offset = 0, search = '', drillOpts = null) => {
    try {
      let url = `/testcases?limit=40&offset=${offset}`;
      if (folderId) url += `&folder_id=${folderId}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (drillOpts?.automated) url += `&automated=${encodeURIComponent(drillOpts.automated)}`;
      if (drillOpts?.changed_action) url += `&changed_action=${encodeURIComponent(drillOpts.changed_action)}`;
      if (drillOpts?.changed_from) url += `&changed_from=${encodeURIComponent(drillOpts.changed_from)}`;
      if (drillOpts?.changed_to) url += `&changed_to=${encodeURIComponent(drillOpts.changed_to)}`;
      if (drillOpts?.zephyr_keys) url += `&zephyr_keys=${encodeURIComponent(drillOpts.zephyr_keys)}`;
      if (drillOpts?.include_deleted) url += `&include_deleted=true`;
      const data = await apiFetch(url);
      setTestCases(data || { items: [], total: 0 });
    } catch (e) { console.error('fetchTestCases:', e); }
  }, []);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, sRes, aRes, cRes] = await Promise.all([
        apiFetch('/folders?with_counts=true'),
        apiFetch('/stats'),
        apiFetch('/actors'),
        apiFetch('/config'),
      ]);
      setFolders(Array.isArray(fRes) ? fRes : []);
      setStats(sRes || { total_cases: 0, total_logs: 0, updates: 0, updates_today: 0, active_cases: 0, audit_events: 0, latest_poll_changes: 0, changes_today: 0, poll_runs: 0, automation_coverage: {}, weekly_activity: [], contributors_week: [], weekly_window: {} });
      setActors(Array.isArray(aRes) ? aRes : []);
      setConfig(cRes);
      setLastSync(new Date());
      await fetchPolls();
    } catch (e) { console.error('fetchInitial:', e); }
    setLoading(false);
  }, [fetchPolls]);

  useEffect(() => { fetchInitial(); }, []); // removed fetchInitial from deps to fix lint error

  const resolveUser = useMemo(() => createUserResolver(actors), [actors]);

  return { polls, pollTotal, folders, testCases, config, stats, actors, loading, lastSync,
    fetchPolls, fetchTestCases, fetchStats, refetch: fetchInitial, resolveUser,
    statsPeriod, setStatsPeriod };
}

/* ═══════════════════════════════════════════════════════════════════
   REUSABLE COMPONENTS
═══════════════════════════════════════════════════════════════════ */
function Badge({ children, color = T.blue, bg, icon: Icon, size = 'sm', gradient }) {
  const sizes = { xs: { p: '2px 6px', f: 10, i: 9 }, sm: { p: '3px 10px', f: 11, i: 11 }, md: { p: '5px 14px', f: 12, i: 12 } };
  const s = sizes[size];
  return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: s.p, borderRadius: 20, fontSize: s.f, fontWeight: 600,
        background: gradient || bg || `${color}20`, color: gradient ? '#fff' : color,
        letterSpacing: '.02em'
      }}>
      {Icon && <Icon size={s.i}/>}
        {children}
    </span>
  );
}

function IconButton({ icon: Icon, onClick, active, disabled, size = 16, title, variant = 'default' }) {
  const variants = {
    default: { bg: active ? T.blueDim : 'transparent', border: active ? T.blue : T.border, color: active ? T.blue : T.textMuted },
    ghost: { bg: 'transparent', border: 'transparent', color: T.textMuted },
    primary: { bg: T.blue, border: T.blue, color: '#fff' },
  };
  const v = variants[variant];
  return (
      <button
          onClick={onClick}
          disabled={disabled}
          title={title}
          aria-label={title}
          style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, border: `1px solid ${v.border}`,
            background: v.bg, color: v.color, opacity: disabled ? 0.5 : 1
          }}
      >
        <Icon size={size}/>
      </button>
  );
}

function EmptyState({ icon: Icon, title, description, action, actionLabel }) {
  return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: `linear-gradient(135deg, ${T.bgSurface} 0%, ${T.card} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
            border: `1px solid ${T.border}`
          }}>
            <Icon size={32} color={T.textDim}/>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8 }}>{title}</h3>
          <p style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, marginBottom: action ? 16 : 0 }}>{description}</p>
          {action && (
              <button onClick={action} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: T.gradBlue, color: '#fff', fontSize: 13, fontWeight: 500
              }}>{actionLabel}</button>
          )}
        </div>
      </div>
  );
}

/* Lightweight skeleton row for loading states (avoids spinner-only screens) */
function SkeletonCard({ height = 92 }) {
  return (
      <div style={{
        height, marginBottom: 12, borderRadius: 16, border: `1px solid ${T.borderLight}`,
        background: `linear-gradient(90deg, ${T.card} 25%, ${T.cardHover} 37%, ${T.card} 63%)`,
        backgroundSize: '400% 100%', animation: 'shimmer 1.4s ease infinite',
      }}/>
  );
}

function ResizeHandle({ onMouseDown }) {
  // 12px grab target with a thin 2px visual line — easy to grab on a trackpad
  // while staying visually subtle.
  return (
      <div
          className="resize-handle hide-narrow"
          onMouseDown={onMouseDown}
          onDoubleClick={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          style={{
            width: 12, flexShrink: 0, cursor: 'col-resize', background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .2s ease'
          }}
      >
        <div style={{ width: 2, height: '100%', background: T.border, transition: 'background .2s ease' }}/>
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ERROR BOUNDARY
═══════════════════════════════════════════════════════════════════ */
class ErrorBoundary extends Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
          <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, background: T.bg }}>
            <div style={{ width: 80, height: 80, borderRadius: 20, background: T.redDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={40} color={T.red}/>
            </div>
            <h1 style={{ color: T.text, fontSize: 20 }}>Something went wrong</h1>
            <p style={{ color: T.textMuted, fontSize: 14 }}>{this.state.error?.message}</p>
            <button onClick={() => window.location.reload()} style={{
              padding: '12px 28px', background: T.gradBlue, color: '#fff',
              border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14
            }}>
              Refresh Page
            </button>
          </div>
      );
    }
    return this.props.children;
  }
}

export { ErrorBoundary };

/* ═══════════════════════════════════════════════════════════════════
   PANEL ERROR BOUNDARY — isolates a single pane so one render error
   doesn't blank the whole dashboard.
═══════════════════════════════════════════════════════════════════ */
class PanelBoundary extends Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('Panel error:', this.props.label, error, info); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.hasError) this.setState({ hasError: false, error: null }); }
  render() {
    if (this.state.hasError) {
      return (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <div style={{ textAlign: 'center', maxWidth: 320 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: T.redDim, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <AlertTriangle size={26} color={T.red}/>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>This panel hit an error</div>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14, wordBreak: 'break-word' }}>{this.state.error?.message || 'Unexpected error'}</div>
              <button onClick={() => this.setState({ hasError: false, error: null })} style={{
                padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 600
              }}>Retry</button>
            </div>
          </div>
      );
    }
    return this.props.children;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   THEME PROVIDER
═══════════════════════════════════════════════════════════════════ */
function ThemeProvider({ children }) {
  const [isDark, setIsDark] = usePersistentState('theme_isDark', true, { shared: true });
  const theme = isDark ? darkTheme : lightTheme;
  // Point the Proxy at the current theme during render so every `T.x` read
  // (including module-level helpers) resolves to the active palette.
  setActiveTheme(theme);
  const toggleTheme = useCallback(() => { setIsDark(prev => !prev); }, [setIsDark]);
  return (
      <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
        {children}
      </ThemeContext.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════════ */
export default function App() {
  return (
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
  );
}

function AppContent() {
  const { theme, isDark, toggleTheme } = useTheme();
  const isNarrow = useMediaQuery('(max-width: 860px)');

  const { polls, pollTotal, folders, testCases, config, stats, actors, loading, lastSync, fetchPolls, fetchTestCases, fetchStats, refetch, resolveUser, statsPeriod, setStatsPeriod } = useAuditData();

  const handlePeriodChange = useCallback((p) => {
    setStatsPeriod(p);
    fetchStats(p);
  }, [setStatsPeriod, fetchStats]);

  const [nav, setNav] = useState('stream');
  const [selectedPoll, setSelectedPoll] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [selectedTestCase, setSelectedTestCase] = useState(null);
  const [pollPresetActionDisplay, setPollPresetActionDisplay] = useState(null);
  const [tcDrillOpts, setTcDrillOpts] = useState(null);
  const [tcDrillLabel, setTcDrillLabel] = useState(null);
  const [streamDrillLabel, setStreamDrillLabel] = useState(null);

  const [filters, setFilters] = useState({ folder: '', actor: '', from: '', to: '', audit_action: '', zephyr_keys: '' });
  const [tcSearch, setTcSearch] = useState('');
  const [tcOffset, setTcOffset] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pollOffset, setPollOffset] = useState(0);

  const drillToAuditTrail = useCallback((row) => {
    const da = row?.drill_audit;
    if (!da) return;
    const actionLabel = !da.audit_action || da.audit_action === 'ALL'
        ? 'all changes'
        : { CREATED: 'New Cases', UPDATED: 'Updated Cases', MOVED_IN: 'Moved In', MOVED_OUT: 'Moved Out', DELETED: 'Deleted' }[da.audit_action] || da.audit_action;
    const nextFilters = {
      folder: '', actor: '',
      from: da.from_iso || '',
      to: da.to_iso || '',
      audit_action: !da.audit_action || da.audit_action === 'ALL' ? '' : da.audit_action,
      zephyr_keys: '',
    };
    setNav('stream');
    setPollOffset(0);
    setSelectedLog(null);
    setSelectedPoll(null);  // clear so merged panel shows by default
    setPollPresetActionDisplay(auditApiActionToDisplayPreset(da.audit_action));
    setStreamDrillLabel(`${actionLabel} · this calendar week`);
    setFilters(nextFilters);
    fetchPolls(nextFilters, { limit: POLLS_PAGE_SIZE, offset: 0 });
  }, [fetchPolls]);

  const drillToAffectedTestcases = useCallback((row) => {
    const dt = row?.drill_testcases;
    if (!dt) return;
    setNav('testcases');
    setSelectedFolder(null);
    setSelectedTestCase(null);
    setTcOffset(0);
    setTcSearch('');
    if (dt.mode === 'all_scoped') {
      setTcDrillOpts(null);
      setTcDrillLabel('All scoped test cases (total inventory)');
      fetchTestCases(null, 0, '', null);
      return;
    }
    const actionDisplayMap = { created: 'New Cases Added', moved_in: 'Moved Into Scope', moved_out: 'Moved Out of Scope', deleted: 'Deleted', updated: 'Updated' };
    const drill = {
      changed_action: dt.changed_action,
      changed_from: dt.from_iso,
      changed_to: dt.to_iso || '',
      include_deleted: true,
    };
    setTcDrillOpts(drill);
    setTcDrillLabel(`${actionDisplayMap[dt.changed_action] || dt.changed_action} · this calendar week`);
    fetchTestCases(null, 0, '', drill);
  }, [fetchTestCases]);

  const drillCoverage = useCallback((automated, label) => {
    setNav('testcases');
    setSelectedFolder(null);
    setSelectedTestCase(null);
    setTcOffset(0);
    setTcSearch('');
    const drill = { automated };
    setTcDrillOpts(drill);
    setTcDrillLabel(label);
    fetchTestCases(null, 0, '', drill);
  }, [fetchTestCases]);

  const drillAutomatedCoverage = useCallback(() => drillCoverage('yes', 'Automated test cases (API / App verified)'), [drillCoverage]);
  const drillManualCoverage = useCallback(() => drillCoverage('no', 'Not Automated test cases'), [drillCoverage]);
  const drillNoneCoverage = useCallback(() => drillCoverage('none', 'Test cases with no automation status'), [drillCoverage]);

  const handleFilterChange = (key, value) => setFilters(f => ({ ...f, [key]: value }));

  // applyFilters now accepts an optional override (used by quick-filter chips/search)
  const applyFilters = (override) => {
    const eff = override ? { ...filters, ...override } : filters;
    if (override) setFilters(eff);
    setPollOffset(0);
    setSelectedPoll(null);
    setSelectedLog(null);
    const nextPreset = eff.audit_action ? auditApiActionToDisplayPreset(eff.audit_action) : null;
    setPollPresetActionDisplay(nextPreset);
    setStreamDrillLabel(null);
    fetchPolls(eff, { limit: POLLS_PAGE_SIZE, offset: 0 });
  };

  const clearFilters = () => {
    setPollOffset(0);
    setPollPresetActionDisplay(null);
    setStreamDrillLabel(null);
    setSelectedLog(null);
    const cleared = { folder: '', actor: '', from: '', to: '', audit_action: '', zephyr_keys: '' };
    setFilters(cleared);
    fetchPolls(cleared, { limit: POLLS_PAGE_SIZE, offset: 0 });
  };

  const handlePollPageChange = (newOffset) => {
    const nextOffset = Math.max(0, newOffset);
    setPollOffset(nextOffset);
    setSelectedPoll(null);
    setSelectedLog(null);
    fetchPolls(filters, { limit: POLLS_PAGE_SIZE, offset: nextOffset });
  };

  const handleFolderSelect = (folderId) => {
    setSelectedFolder(folderId);
    setTcDrillOpts(null);
    setTcDrillLabel(null);
    setTcOffset(0);
    fetchTestCases(folderId, 0, tcSearch, null);
  };

  const handleTcSearch = (search) => {
    setTcSearch(search);
    setTcDrillOpts(null);
    setTcDrillLabel(null);
    setTcOffset(0);
    fetchTestCases(selectedFolder, 0, search, null);
  };

  const handleTcPage = (newOffset) => {
    setTcOffset(newOffset);
    fetchTestCases(selectedFolder, newOffset, tcSearch, tcDrillOpts || null);
  };

  const clearTcDrill = useCallback(() => {
    setTcDrillOpts(null);
    setTcDrillLabel(null);
    setSelectedFolder(null);
    setTcOffset(0);
    fetchTestCases(null, 0, tcSearch, null);
  }, [fetchTestCases, tcSearch]);

  // Auto-select the latest poll so the right panels are populated by default
  // (no more double "empty state"). Skipped while a sidebar drill is active.
  useEffect(() => {
    if (nav !== 'stream' || streamDrillLabel || selectedPoll || polls.length === 0) return;
    setSelectedPoll(polls[0]);
  }, [nav, polls, streamDrillLabel, selectedPoll]);

  // Live refresh while a poll is running
  useEffect(() => {
    const hasRunningPoll = nav === 'stream' && polls.some(poll => poll.status === 'running');
    if (!hasRunningPoll) return undefined;
    const timer = setInterval(() => {
      fetchPolls(filters, { limit: POLLS_PAGE_SIZE, offset: pollOffset });
      fetchStats();
    }, 3000);
    return () => clearInterval(timer);
  }, [nav, polls, filters, pollOffset, fetchPolls, fetchStats]);

  // Keep selected poll in sync with refreshed data
  useEffect(() => {
    if (!selectedPoll) return;
    const freshPoll = polls.find(poll => poll.poll_id === selectedPoll.poll_id);
    if (freshPoll && freshPoll !== selectedPoll) setSelectedPoll(freshPoll);
  }, [polls, selectedPoll]);

  // Data freshness: use the newest poll on the first page as the source of truth.
  const latestPollTs = useMemo(() => (pollOffset === 0 && polls.length ? polls[0].poll_timestamp : null), [pollOffset, polls]);
  const isStale = useMemo(() => (latestPollTs ? (Date.now() - new Date(latestPollTs).getTime()) > STALE_AFTER_MS : false), [latestPollTs]);

  // On narrow viewports force the sidebar to its collapsed rail.
  const sidebarIsCollapsed = sidebarCollapsed || isNarrow;

  if (loading) return <LoadingScreen />;

  return (
      <>
        <style>{buildGS()}</style>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
          <Sidebar
              nav={nav} onNav={setNav} stats={stats}
              lastSync={lastSync} onRefresh={refetch}
              collapsed={sidebarIsCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarIsCollapsed)}
              lockCollapsed={isNarrow}
              isDark={isDark} onToggleTheme={toggleTheme}
              onDrillAudit={drillToAuditTrail}
              onDrillTestcases={drillToAffectedTestcases}
              onDrillAutomated={drillAutomatedCoverage}
              onDrillManual={drillManualCoverage}
              onDrillNone={drillNoneCoverage}
              statsPeriod={statsPeriod}
              onPeriodChange={handlePeriodChange}
          />

          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme.bg }}>
            {nav === 'stream' && (
                <PanelBoundary label="stream" resetKey={`${nav}-${selectedPoll?.poll_id || ''}`}>
                  <LiveStreamView
                      polls={polls} actors={actors} folders={folders}
                      filters={filters} onFilterChange={handleFilterChange}
                      onApplyFilters={applyFilters} onClearFilters={clearFilters}
                      selectedPoll={selectedPoll} onSelectPoll={setSelectedPoll}
                      selectedLog={selectedLog} onSelectLog={setSelectedLog}
                      pollOffset={pollOffset} pollTotal={pollTotal} onPollPageChange={handlePollPageChange}
                      resolveUser={resolveUser}
                      pollPresetDisplayAction={pollPresetActionDisplay}
                      drillLabel={streamDrillLabel}
                      isStale={isStale} latestPollTs={latestPollTs} onRefresh={refetch}
                      isNarrow={isNarrow}
                  />
                </PanelBoundary>
            )}

            {nav === 'testcases' && (
                <PanelBoundary label="testcases" resetKey={`${nav}-${selectedFolder || ''}`}>
                  <TestRepositoryView
                      folders={folders} testCases={testCases}
                      selectedFolder={selectedFolder} onSelectFolder={handleFolderSelect}
                      selectedTestCase={selectedTestCase} onSelectTestCase={setSelectedTestCase}
                      search={tcSearch} onSearch={handleTcSearch}
                      offset={tcOffset} onPageChange={handleTcPage}
                      resolveUser={resolveUser}
                      drillLabel={tcDrillLabel}
                      onClearDrill={clearTcDrill}
                      isNarrow={isNarrow}
                  />
                </PanelBoundary>
            )}

            {nav === 'qa-checklist' && (
                <PanelBoundary label="qa-checklist" resetKey={nav}>
                  <QAChecklistPage />
                </PanelBoundary>
            )}

            {nav === 'config' && (
                <PanelBoundary label="config" resetKey={nav}>
                  <ConfigView config={config} actors={actors} folders={folders} onRefresh={refetch} stats={stats}/>
                </PanelBoundary>
            )}
          </main>
        </div>
      </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════════════════════ */
function Sidebar({ nav, onNav, stats, lastSync, onRefresh, collapsed, onToggleCollapse, lockCollapsed, isDark, onToggleTheme, onDrillAudit, onDrillTestcases, onDrillAutomated, onDrillManual, onDrillNone, statsPeriod, onPeriodChange }) {
  const [syncing, setSyncing] = useState(false);
  const automation = stats.automation_coverage || {};
  const weeklyActivity = stats.weekly_activity || [];
  const contributors = stats.contributors_week || [];
  const weeklyWindow = stats.weekly_window || {};

  const autoCount = Number(automation.automated_cases || 0);
  const notAutoCount = Number(automation.not_automated_cases ?? automation.manual_cases ?? 0);
  const noneCount = Number(automation.none_cases || 0);
  const pieTotal = autoCount + notAutoCount + noneCount;
  const hasAutomationStats = pieTotal > 0;

  const periodLabel = weeklyWindow.label || 'This Period';

  const items = [
    { id: 'stream', icon: Activity, label: 'Audit Stream', color: T.blue, gradient: T.gradBlue },
    { id: 'testcases', icon: Layers, label: 'Test Cases', color: T.purple, gradient: T.gradPurple },
    { id: 'qa-checklist', icon: ListChecks, label: 'QA Checklist', color: T.green, gradient: T.gradGreen },
    { id: 'config', icon: Settings, label: 'Settings', color: T.orange, gradient: T.gradOrange },
  ];

  const handleSync = async () => {
    setSyncing(true);
    await onRefresh();
    setSyncing(false);
  };

  return (
      <aside style={{
        width: collapsed ? 64 : 280, background: T.sidebar, borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', transition: 'width .25s cubic-bezier(.4,0,.2,1)',
        flexShrink: 0, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: collapsed ? '14px 0' : '15px 16px 13px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: T.gradBlue, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(96,165,250,.3)',
            }}>
              <History size={18} color="#fff"/>
            </div>
            {!collapsed && (
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: '-.02em', lineHeight: 1.2 }}>Zephyr Audit</div>
                  <div style={{ fontSize: 10, color: T.teal, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 6, background: T.teal, display: 'inline-block', animation: 'pulseDot 2s ease-in-out infinite' }}/>
                    Live monitoring
                  </div>
                </div>
            )}
          </div>
        </div>

        {/* Nav Items */}
        <nav style={{ padding: '6px 8px', flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
          {items.map(item => {
            const Icon = item.icon;
            const isActive = nav === item.id;
            return (
                <button
                    key={item.id}
                    className={`sb-nav-btn${isActive ? ' active' : ''}`}
                    onClick={() => onNav(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    style={{
                      gap: 10, padding: collapsed ? '10px 0' : '8px 11px', borderRadius: 8, marginBottom: 2,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: isActive ? item.gradient : 'transparent',
                      color: isActive ? '#fff' : T.textMuted,
                      boxShadow: isActive ? `0 3px 10px ${item.color}25` : 'none',
                    }}
                >
                  <Icon size={16}/>
                  {!collapsed && <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>}
                </button>
            );
          })}
        </nav>

        {/* Scrollable Analytics (expanded) */}
        {!collapsed && (
            <div className="sidebar-metrics" style={{ flex: 1, overflowY: 'auto', padding: '11px 11px 20px' }}>
              <SidebarSection icon={BarChart3} title="Automation Coverage"/>
              <InteractivePieChart
                  automated={autoCount}
                  notAutomated={notAutoCount}
                  none={noneCount}
                  total={pieTotal}
                  onClickAutomated={onDrillAutomated}
                  onClickNotAutomated={onDrillManual}
                  onClickNone={onDrillNone}
                  deltaAutomated={automation.automated_delta_count}
                  baselineAt={automation.baseline_at}
                  nav={nav}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 6, padding: '0 1px' }}>
                <Calendar size={10} color={T.textDim}/>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: T.textDim, flex: 1 }}>
              Activity
            </span>
                {weeklyWindow.from_iso && (
                    <span style={{ fontSize: 8, color: T.textDim, fontWeight: 500 }} title={`Window start: ${fmtDate(weeklyWindow.from_iso, 'detail')}`}>
                {fmtDate(weeklyWindow.from_iso, 'short')}
              </span>
                )}
              </div>
              <PeriodSelector current={statsPeriod || '7d'} onChange={onPeriodChange}/>
              <WeeklyActivityCard rows={weeklyActivity} onDrillAudit={onDrillAudit}/>

              <SidebarSection icon={Users} title={`Contributors · ${periodLabel}`} marginTop={16}/>
              <ContributorsCard contributors={contributors}/>
            </div>
        )}

        {/* Collapsed Analytics */}
        {collapsed && (
            <div style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
              <CollapsedMetric icon={BarChart3} value={hasAutomationStats ? `${Math.round((autoCount / pieTotal) * 100)}%` : '--'} color={T.green} title="Automation coverage"/>
              <CollapsedMetric icon={Calendar} value={stats.changes_today ?? 0} color={T.orange} title="Changes today"/>
              <CollapsedMetric icon={Users} value={(contributors || []).length} color={T.blue} title="Contributors"/>
              <button
                  onClick={handleSync}
                  disabled={syncing}
                  title="Sync & Refresh"
                  aria-label="Sync and refresh"
                  style={{
                    width: 44, height: 36, borderRadius: 10, border: `1px solid ${T.border}`,
                    background: T.card, color: syncing ? T.textDim : T.blue,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4,
                  }}
              >
                <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}/>
              </button>
            </div>
        )}

        {/* Sync Button (expanded) */}
        {!collapsed && (
            <div style={{ padding: '9px 10px 10px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
              <button
                  onClick={handleSync}
                  disabled={syncing}
                  style={{
                    width: '100%', padding: '9px 0', borderRadius: 9, border: 'none',
                    background: syncing ? T.card : T.gradBlue, color: syncing ? T.textMuted : '#fff',
                    fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    boxShadow: syncing ? 'none' : '0 3px 12px rgba(96,165,250,.25)',
                    opacity: syncing ? 0.7 : 1,
                  }}
              >
                <RefreshCw size={12} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}/>
                {syncing ? 'Syncing…' : 'Sync & Refresh'}
              </button>
              {lastSync && (
                  <div style={{ textAlign: 'center', marginTop: 5, fontSize: 8, color: T.textDim, letterSpacing: '.02em' }}>
                    Synced {fmtDate(lastSync, 'time')}
                  </div>
              )}
            </div>
        )}

        {/* Footer: Theme + Collapse */}
        <div style={{ borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
          <button
              onClick={onToggleTheme}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              style={{
                flex: 1, padding: collapsed ? 13 : '10px 13px', background: 'transparent',
                border: 'none', color: T.textMuted, display: 'flex', alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start', gap: 8,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; }}
          >
            {isDark ? <Sun size={15} color={T.yellow}/> : <Moon size={15} color={T.purple}/>}
            {!collapsed && <span style={{ fontSize: 11, fontWeight: 500 }}>{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>
          {!lockCollapsed && (
              <button
                  onClick={onToggleCollapse}
                  title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  style={{
                    padding: '0 13px', background: 'transparent', border: 'none',
                    borderLeft: `1px solid ${T.border}`, color: T.textMuted,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
                  onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; }}
              >
                {collapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}
              </button>
          )}
        </div>
      </aside>
  );
}

function SidebarSection({ icon: Icon, title, marginTop = 0 }) {
  return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop, marginBottom: 7, padding: '0 1px' }}>
        <Icon size={10} color={T.textDim} style={{ flexShrink: 0 }}/>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: T.textDim, whiteSpace: 'nowrap' }}>{title}</span>
        <div style={{ flex: 1, height: '1px', background: T.borderLight, marginLeft: 3 }}/>
      </div>
  );
}

function CollapsedMetric({ icon: Icon, value, color, title }) {
  return (
      <div title={`${title}: ${value}`} style={{ width: 44, padding: '8px 4px', borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <Icon size={14} color={color}/>
        <div className="num" style={{ fontSize: 10, fontWeight: 800, color: T.text, maxWidth: 38, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof value === 'number' ? Number(value || 0).toLocaleString() : value}</div>
      </div>
  );
}

/* ── Interactive Donut Pie Chart ── */
function InteractivePieChart({ automated, notAutomated, none, total, onClickAutomated, onClickNotAutomated, onClickNone, deltaAutomated, baselineAt, nav }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0, visible: false });

  useEffect(() => { if (nav !== 'testcases') setSelected(null); }, [nav]);

  const hasData = total > 0;
  const segments = [
    { key: 'automated',     label: 'Automated',     count: automated,    color: T.green,   dimColor: T.greenDark, onClick: onClickAutomated },
    { key: 'not_automated', label: 'Not Automated', count: notAutomated, color: T.red,     dimColor: T.redDark,   onClick: onClickNotAutomated },
    { key: 'none',          label: 'No Status',     count: none,         color: T.textDim, dimColor: T.textMuted, onClick: onClickNone },
  ];

  const cx = 50, cy = 50, R = 42, r = 28;
  const GAP_DEG = 2;

  const toXY = (angleDeg, radius) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  function arcPath(sa, ea, outerR, innerR) {
    if (Math.abs(ea - sa) >= 359.5) {
      const m = sa + (ea - sa) / 2;
      const o1 = toXY(sa, outerR), o2 = toXY(m, outerR), o3 = toXY(ea - 0.01, outerR);
      const i1 = toXY(sa, innerR), i2 = toXY(m, innerR), i3 = toXY(ea - 0.01, innerR);
      return `M${o1.x} ${o1.y} A${outerR} ${outerR} 0 1 1 ${o2.x} ${o2.y} A${outerR} ${outerR} 0 1 1 ${o3.x} ${o3.y}
              L${i3.x} ${i3.y} A${innerR} ${innerR} 0 1 0 ${i2.x} ${i2.y} A${innerR} ${innerR} 0 1 0 ${i1.x} ${i1.y} Z`;
    }
    const lg = ea - sa > 180 ? 1 : 0;
    const o1 = toXY(sa, outerR), o2 = toXY(ea, outerR);
    const i1 = toXY(ea, innerR), i2 = toXY(sa, innerR);
    return `M${o1.x} ${o1.y} A${outerR} ${outerR} 0 ${lg} 1 ${o2.x} ${o2.y} L${i1.x} ${i1.y} A${innerR} ${innerR} 0 ${lg} 0 ${i2.x} ${i2.y} Z`;
  }

  let arcs = [];
  if (hasData) {
    const visSegs = segments.filter(s => s.count > 0);
    let angle = 0;
    visSegs.forEach((seg, idx) => {
      const sweep = (seg.count / total) * 360;
      const gapBefore = idx === 0 ? 0 : GAP_DEG / 2;
      const gapAfter  = idx === visSegs.length - 1 ? 0 : GAP_DEG / 2;
      const sa = angle + gapBefore;
      const ea = angle + sweep - gapAfter;
      if (ea > sa + 0.5) arcs.push({ ...seg, startAngle: sa, endAngle: ea, sweep });
      angle += sweep;
    });
    if (arcs.length === 1) { arcs[0].startAngle = 0; arcs[0].endAngle = 359.9; }
  }

  const activeSeg = hovered ? segments.find(s => s.key === hovered) : (selected ? segments.find(s => s.key === selected) : null);
  const autoPct = total > 0 ? Math.round((automated / total) * 100) : 0;
  const hasDelta = typeof deltaAutomated === 'number' && deltaAutomated !== 0 && hasData;
  const deltaTitle = hasDelta
      ? `${deltaAutomated > 0 ? '+' : ''}${deltaAutomated} automated case${Math.abs(deltaAutomated) !== 1 ? 's' : ''} vs this week's Monday baseline`
      : undefined;

  const tipW = 168;
  const tipX = Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1000) - tipW - 10);
  const tipY = Math.max(tooltip.y - 66, 8);

  return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px', marginBottom: 4 }}
           onClick={(e) => {
             const tag = e.target.tagName.toLowerCase();
             if (tag !== 'button' && tag !== 'path') setSelected(null);
           }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative', flexShrink: 0, width: 100, height: 100 }}>
            <svg width={100} height={100} viewBox="0 0 100 100" role="img" aria-label={hasData ? `${autoPct}% automated of ${total} cases` : 'No automation data'}>
              <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={T.borderLight} strokeWidth={R - r}/>
              {hasData ? arcs.map((arc) => {
                const isActive = hovered === arc.key || selected === arc.key;
                return (
                    <path
                        key={arc.key}
                        className="pie-arc"
                        d={arcPath(arc.startAngle, arc.endAngle, isActive ? R + 2 : R, isActive ? r - 1 : r)}
                        fill={isActive ? arc.dimColor : arc.color}
                        style={{ cursor: 'pointer', transition: 'all 0.2s ease-out', filter: isActive ? 'brightness(1.2)' : 'none', opacity: (hovered || selected) && !isActive ? 0.4 : 1 }}
                        onMouseEnter={(e) => { setHovered(arc.key); setTooltip({ x: e.clientX, y: e.clientY, visible: true }); }}
                        onMouseLeave={() => { setHovered(null); setTooltip(t => ({ ...t, visible: false })); }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selected === arc.key) setSelected(null);
                          else { setSelected(arc.key); arc.onClick?.(); }
                        }}
                    >
                      <title>{`${arc.label}: ${arc.count.toLocaleString()} (${Math.round((arc.count / total) * 100)}%)`}</title>
                    </path>
                );
              }) : (
                  <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={T.border} strokeWidth={R - r} strokeDasharray="4 3"/>
              )}
              {activeSeg ? (
                  <>
                    <text x={cx} y={cy - 2} textAnchor="middle" fill={activeSeg.color} fontSize={20} fontWeight={800} fontFamily="inherit">
                      {Math.round((activeSeg.count / total) * 100)}%
                    </text>
                    <text x={cx} y={cy + 12} textAnchor="middle" fill={T.textDim} fontSize={10} fontWeight={600} fontFamily="inherit">
                      {Number(activeSeg.count).toLocaleString()}
                    </text>
                  </>
              ) : (
                  <>
                    <text x={cx} y={cy + (hasDelta ? -2 : 6)} textAnchor="middle" fill={hasData ? T.text : T.textDim} fontSize={hasData ? 22 : 14} fontWeight={800} fontFamily="inherit">
                      {hasData ? `${autoPct}%` : '--'}
                    </text>
                    {!hasData && (
                        <text x={cx} y={cy + 18} textAnchor="middle" fill={T.textDim} fontSize={8} fontWeight={600} letterSpacing="0.05em" fontFamily="inherit">NO DATA</text>
                    )}
                    {hasDelta && (
                        <text x={cx} y={cy + 14} textAnchor="middle" fill={deltaAutomated > 0 ? T.green : T.red} fontSize={9} fontWeight={700} fontFamily="inherit">
                          {deltaAutomated > 0 ? '▲' : '▼'} {Math.abs(deltaAutomated)} cases
                          <title>{deltaTitle}</title>
                        </text>
                    )}
                  </>
              )}
            </svg>
            {tooltip.visible && hovered && segments.find(s => s.key === hovered) && (() => {
              const hovSeg = segments.find(s => s.key === hovered);
              return (
                  <div style={{
                    position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: tipX, top: tipY,
                    background: T.card, border: `1px solid ${hovSeg.color}55`, borderRadius: 9,
                    padding: '6px 11px', boxShadow: '0 6px 20px rgba(0,0,0,.3)', whiteSpace: 'nowrap', minWidth: tipW,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: hovSeg.color, flexShrink: 0 }}/>
                      <span style={{ fontSize: 10, fontWeight: 700, color: hovSeg.color }}>{hovSeg.label}</span>
                    </div>
                    <div className="num" style={{ fontSize: 13, fontWeight: 800, color: T.text, marginTop: 2 }}>
                      {hovSeg.count.toLocaleString()} <span style={{ fontSize: 10, fontWeight: 500, color: T.textMuted }}>of {total.toLocaleString()} · {Math.round((hovSeg.count / total) * 100)}%</span>
                    </div>
                    <div style={{ fontSize: 8, color: T.textDim, marginTop: 3 }}>↗ Click to filter in Test Cases</div>
                  </div>
              );
            })()}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {segments.map((seg) => {
              const isActive = hovered === seg.key || selected === seg.key;
              const hasCount = seg.count > 0;
              const pct = total > 0 ? Math.round((seg.count / total) * 100) : 0;
              return (
                  <button
                      key={seg.key}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (selected === seg.key) setSelected(null); else { setSelected(seg.key); seg.onClick?.(); } }}
                      onMouseEnter={() => setHovered(seg.key)}
                      onMouseLeave={() => setHovered(null)}
                      title={`${seg.label}: ${Number(seg.count).toLocaleString()} cases (${pct}%) — click to filter`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        borderRadius: 8, border: `1px solid ${isActive ? `${seg.color}50` : 'transparent'}`,
                        background: isActive ? `${seg.color}15` : 'transparent',
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                        transition: 'all .14s', opacity: !hasCount && !isActive ? 0.5 : 1,
                      }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: seg.color, flexShrink: 0, opacity: hasCount ? 1 : 0.4 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? seg.color : T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {seg.label}
                      </div>
                      <div className="num" style={{ fontSize: 9, color: T.textDim, whiteSpace: 'nowrap' }}>
                        {Number(seg.count).toLocaleString()} · {pct}%
                      </div>
                    </div>
                  </button>
              );
            })}
          </div>
        </div>
        {hasData && (
            <div
                title="Deltas are measured against an inventory snapshot taken at the start of this calendar week (Monday 00:00)."
                style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 9, paddingTop: 8, borderTop: `1px solid ${T.borderLight}`, fontSize: 9, color: T.textDim }}
            >
              <Info size={9}/>
              <span className="num">{total.toLocaleString()} cases total</span>
              {baselineAt && <span>· vs week baseline ({fmtDate(baselineAt, 'short')})</span>}
            </div>
        )}
      </div>
  );
}

/* ── Period Selector ── */
function PeriodSelector({ current, onChange }) {
  const options = [
    { value: '1d',   label: '24h' },
    { value: '7d',   label: '1 Week' },
    { value: '30d',  label: '1 Month' },
    { value: 'all',  label: 'All' },
  ];
  return (
      <div role="tablist" aria-label="Activity period" style={{ display: 'flex', gap: 3, marginBottom: 7, background: T.bgAlt, borderRadius: 9, padding: 3 }}>
        {options.map(opt => {
          const isActive = current === opt.value;
          return (
              <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`period-pill${isActive ? ' active' : ''}`}
                  onClick={() => onChange?.(opt.value)}
                  style={{
                    padding: '5px 0', fontSize: 10, fontWeight: isActive ? 700 : 500,
                    background: isActive ? T.gradBlue : 'transparent',
                    color: isActive ? '#fff' : T.textDim,
                    boxShadow: isActive ? '0 2px 6px rgba(96,165,250,.35)' : 'none',
                    borderRadius: 6,
                  }}
              >
                {opt.label}
              </button>
          );
        })}
      </div>
  );
}

function WeeklyActivityCard({ rows, onDrillAudit }) {
  const meta = {
    created:  { color: T.green,  icon: Plus,       label: 'New Cases' },
    moved_in: { color: T.teal,   icon: ArrowRight, label: 'Moved In' },
    moved_out:{ color: T.purple, icon: Move,       label: 'Moved Out' },
    deleted:  { color: T.red,    icon: Trash2,     label: 'Archived' },
    updated:  { color: T.yellow, icon: GitCommit,  label: 'Updated' },
  };

  const actionRows = (rows || []).filter(r => r.key !== 'total_cases');

  if (!actionRows.length) {
    return (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 12px', textAlign: 'center', color: T.textDim, fontSize: 11 }}>
          No activity data
        </div>
    );
  }

  return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {actionRows.map((row, index) => {
          const m = meta[row.key] || { color: T.yellow, icon: GitCommit, label: row.label };
          const { color, icon: RowIcon, label } = m;
          const delta = describeDelta(row.delta_pct);
          const dcol = delta.tone === 'up' ? T.green : delta.tone === 'down' ? T.red : T.textDim;
          const DeltaIcon = delta.kind === 'new' ? Sparkles : delta.kind === 'up' ? TrendingUp : delta.kind === 'down' ? TrendingDown : Minus;
          const hasAuditDrill = !!row.drill_audit;
          const isLast = index === actionRows.length - 1;

          return (
              <button
                  key={row.key || index}
                  type="button"
                  className={hasAuditDrill ? 'activity-row' : undefined}
                  onClick={() => hasAuditDrill && onDrillAudit?.(row)}
                  aria-label={hasAuditDrill ? `${label}: ${row.count}, ${delta.label}. Open in audit stream.` : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px',
                    background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left',
                    borderBottom: isLast ? 'none' : `1px solid ${T.borderLight}`,
                    cursor: hasAuditDrill ? 'pointer' : 'default',
                  }}
              >
                <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color}22` }}>
                  <RowIcon size={13} color={color}/>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                    {label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
                    <DeltaIcon size={9} color={dcol}/>
                    <span style={{ fontSize: 9, fontWeight: 600, color: dcol }}>{delta.label}</span>
                  </div>
                </div>

                <div className="num" style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1.1, flexShrink: 0 }}>
                  {Number(row.count || 0).toLocaleString()}
                </div>
                {hasAuditDrill && (
                    <ChevronRight className="drill-caret" size={14} color={T.textDim} style={{ flexShrink: 0, transition: 'transform .15s, color .15s' }}/>
                )}
              </button>
          );
        })}
      </div>
  );
}

function ContributorsCard({ contributors }) {
  const max = Math.max(...(contributors || []).map(item => item.share || 0), 1);
  const avatarColors = [T.blue, T.purple, T.teal, T.orange, T.pink];
  return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {(contributors || []).length === 0 ? (
            <div style={{ padding: '14px 12px', color: T.textDim, fontSize: 11, textAlign: 'center' }}>No contributors this period</div>
        ) : contributors.map((item, index) => {
          const unresolved = item.is_system || isUnknownActor(item.name);
          const initials = String(item.name || 'U').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
          const avatarBg = unresolved ? T.yellowDim : avatarColors[index % avatarColors.length];
          return (
              <div key={`${item.name}-${index}`}
                   title={unresolved ? 'Display name could not be resolved — re-sync to attempt resolution from Jira.' : item.name}
                   style={{
                     display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                     borderBottom: index === contributors.length - 1 ? 'none' : `1px solid ${T.borderLight}`,
                   }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                  background: unresolved ? T.yellowDim : `${avatarBg}30`,
                  color: unresolved ? T.yellow : avatarBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, border: `1px solid ${unresolved ? `${T.yellow}40` : `${avatarBg}40`}`,
                }}>
                  {unresolved ? <AlertTriangle size={12}/> : initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: unresolved ? T.yellow : T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                    {unresolved && <span style={{ fontSize: 8, fontWeight: 700, color: T.yellow, background: T.yellowDim, padding: '1px 5px', borderRadius: 5, flexShrink: 0 }}>UNRESOLVED</span>}
                  </div>
                  <div style={{ height: 3, background: T.bgAlt, borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ width: `${Math.min((item.share || 0) / max * 100, 100)}%`, height: '100%', background: unresolved ? T.yellowDark : avatarBg, borderRadius: 2, transition: 'width .3s ease' }}/>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="num" style={{ fontSize: 12, fontWeight: 800, color: unresolved ? T.textDim : T.text }}>{Number(item.count || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 8, color: T.textDim, textTransform: 'uppercase', letterSpacing: '.04em' }}>events</div>
                </div>
              </div>
          );
        })}
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LIVE STREAM VIEW
═══════════════════════════════════════════════════════════════════ */
const firstLogOfPoll = (poll) => {
  for (const data of Object.values(poll?.folders || {})) {
    if ((data.changes || []).length) return data.changes[0];
  }
  return null;
};

const ACTION_CHIPS = [
  { value: '', label: 'All', color: T => T.blue },
  { value: 'CREATED', label: 'Created' },
  { value: 'UPDATED', label: 'Updated' },
  { value: 'MOVED_IN', label: 'Moved In' },
  { value: 'MOVED_OUT', label: 'Moved Out' },
  { value: 'DELETED', label: 'Deleted' },
];

function StaleBanner({ latestPollTs, onRefresh }) {
  return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px',
        background: T.yellowDim, borderBottom: `1px solid ${T.yellow}40`,
      }}>
        <AlertTriangle size={14} color={T.yellow}/>
        <span style={{ flex: 1, fontSize: 11, color: T.text, fontWeight: 500 }}>
        Data may be stale — last sync {relativeTime(latestPollTs)}.
      </span>
        <button onClick={onRefresh} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7,
          border: `1px solid ${T.yellow}60`, background: 'transparent', color: T.yellowDark || T.yellow,
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          <RefreshCw size={11}/> Sync now
        </button>
      </div>
  );
}

function LiveStreamView({ polls, actors, folders, filters, onFilterChange, onApplyFilters, onClearFilters, selectedPoll, onSelectPoll, selectedLog, onSelectLog, pollOffset, pollTotal, onPollPageChange, resolveUser, pollPresetDisplayAction, drillLabel, isStale, latestPollTs, onRefresh, isNarrow }) {
  const [showFilters, setShowFilters] = useSessionState('audit_showFilters', false);
  const [hideEmpty, setHideEmpty] = useSessionState('audit_hideEmpty', true);
  const [keyInput, setKeyInput] = useState(filters.zephyr_keys || '');
  const pollsPanel = useResizable(380, 280, 520);
  const changesPanel = useResizable(420, 300, 600);

  const activeFilterCount = Object.values(filters || {}).filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  useEffect(() => { setKeyInput(filters.zephyr_keys || ''); }, [filters.zephyr_keys]);

  useEffect(() => {
    if (drillLabel && hasActiveFilters) setShowFilters(true);
  }, [drillLabel, hasActiveFilters, setShowFilters]);

  // Auto-select first change of the selected poll so the diff panel is populated
  useEffect(() => {
    if (!selectedPoll || drillLabel || selectedLog || !onSelectLog) return;
    const first = firstLogOfPoll(selectedPoll);
    if (first) onSelectLog(first);
  }, [selectedPoll, drillLabel, selectedLog, onSelectLog]);

  // Keyboard navigation: ↑/↓ move between polls
  const visiblePolls = useMemo(
      () => (hideEmpty && !hasActiveFilters && !drillLabel ? polls.filter(p => (p.total_changes || 0) > 0 || p.status === 'running') : polls),
      [polls, hideEmpty, hasActiveFilters, drillLabel]
  );

  useEffect(() => {
    const handler = (e) => {
      if (!visiblePolls.length) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const idx = visiblePolls.findIndex(p => p.poll_id === selectedPoll?.poll_id);
      const nextIdx = e.key === 'ArrowDown'
          ? Math.min(visiblePolls.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx < 0 ? 0 : idx - 1);
      onSelectPoll(visiblePolls[nextIdx]);
      if (onSelectLog) onSelectLog(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visiblePolls, selectedPoll, onSelectPoll, onSelectLog]);

  const handleChipClick = (value) => {
    onFilterChange('audit_action', value);
    onApplyFilters({ audit_action: value });
  };

  const handleKeySearch = () => {
    onFilterChange('zephyr_keys', keyInput.trim());
    onApplyFilters({ zephyr_keys: keyInput.trim() });
  };

  return (
      <div className="pane-row" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Poll List Column */}
        <div className="pane" style={{ width: isNarrow ? '100%' : pollsPanel.width, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bgAlt }}>
          {isStale && <StaleBanner latestPollTs={latestPollTs} onRefresh={onRefresh}/>}

          {/* Quick filter bar (always visible) */}
          <div style={{ borderBottom: `1px solid ${T.border}`, background: T.card, padding: '12px 14px 10px' }}>
            {/* Search + advanced toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textDim }}/>
                <input
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleKeySearch()}
                    placeholder="Search by key (e.g. QA-T123)…"
                    aria-label="Search by Zephyr key"
                    style={{ width: '100%', padding: '8px 10px 8px 32px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgSurface, color: T.text, fontSize: 12 }}
                />
                {keyInput && (
                    <button onClick={() => { setKeyInput(''); onFilterChange('zephyr_keys', ''); onApplyFilters({ zephyr_keys: '' }); }}
                            aria-label="Clear search"
                            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer', padding: 4 }}>
                      <X size={12}/>
                    </button>
                )}
              </div>
              <button
                  onClick={() => setShowFilters(!showFilters)}
                  title="Advanced filters"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8,
                    border: `1px solid ${hasActiveFilters ? T.blue : T.border}`,
                    background: hasActiveFilters ? T.blueDim : 'transparent', color: hasActiveFilters ? T.blue : T.textMuted,
                    fontSize: 12, fontWeight: 600,
                  }}
              >
                <SlidersHorizontal size={14}/>
                {activeFilterCount > 0 && <span className="num">{activeFilterCount}</span>}
                {showFilters ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
              </button>
            </div>

            {/* Action chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {ACTION_CHIPS.map(chip => {
                const active = (filters.audit_action || '') === chip.value;
                const c = chip.value ? actionConfig(chip.value === 'MOVED_OUT' ? 'MOVED' : chip.value).c : T.blue;
                return (
                    <button
                        key={chip.value || 'all'}
                        className={`chip${active ? ' active' : ''}`}
                        onClick={() => handleChipClick(chip.value)}
                        aria-pressed={active}
                        style={{
                          padding: '4px 11px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                          border: `1px solid ${active ? c : T.border}`,
                          background: active ? `${c}1f` : 'transparent',
                          color: active ? c : T.textMuted, cursor: 'pointer',
                        }}
                    >
                      {chip.label}
                    </button>
                );
              })}
            </div>

            {/* Has-changes-only toggle */}
            {!hasActiveFilters && !drillLabel && (
                <button
                    onClick={() => setHideEmpty(!hideEmpty)}
                    aria-pressed={hideEmpty}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0',
                      background: 'transparent', border: 'none', color: T.textMuted, fontSize: 11, fontWeight: 500,
                    }}
                >
              <span style={{
                width: 30, height: 17, borderRadius: 10, background: hideEmpty ? T.blue : T.border,
                position: 'relative', transition: 'background .2s', flexShrink: 0,
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: hideEmpty ? 15 : 2, width: 13, height: 13, borderRadius: 7,
                  background: '#fff', transition: 'left .2s',
                }}/>
              </span>
                  Hide polls with no changes
                </button>
            )}

            {/* Advanced filters (collapsible) */}
            {showFilters && (
                <div style={{ paddingTop: 8, marginTop: 4, borderTop: `1px solid ${T.borderLight}`, animation: 'slideIn .2s ease' }}>
                  <FilterField label="Folder" icon={Folder} color={T.yellow}>
                    <select value={filters.folder} onChange={e => onFilterChange('folder', e.target.value)} style={selectStyle(filters.folder)}>
                      <option value="">All Folders</option>
                      {folders.map(f => <option key={f.folder_id} value={f.name}>{f.name}</option>)}
                    </select>
                  </FilterField>

                  <FilterField label="Changed By" icon={User} color={T.purple}>
                    <select value={filters.actor} onChange={e => onFilterChange('actor', e.target.value)} style={selectStyle(filters.actor)}>
                      <option value="">All Users</option>
                      {actors.map(a => <option key={a.account_id} value={a.display_name}>{a.display_name}</option>)}
                    </select>
                  </FilterField>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                    <FilterField label="From" icon={Calendar} color={T.teal} inline>
                      <input type="date" value={filters.from?.split('T')[0] || ''} onChange={e => onFilterChange('from', e.target.value ? `${e.target.value}T00:00:00Z` : '')} style={inputStyle()}/>
                    </FilterField>
                    <FilterField label="To" icon={Calendar} color={T.pink} inline>
                      <input type="date" value={filters.to?.split('T')[0] || ''} onChange={e => onFilterChange('to', e.target.value ? `${e.target.value}T23:59:59Z` : '')} style={inputStyle()}/>
                    </FilterField>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button onClick={() => onApplyFilters()} style={{
                      flex: 1, padding: 11, borderRadius: 10, border: 'none',
                      background: T.gradBlue, color: '#fff', fontSize: 13, fontWeight: 600,
                      boxShadow: '0 4px 15px rgba(96,165,250,.3)'
                    }}>
                      Apply Filters
                    </button>
                    {hasActiveFilters && (
                        <button onClick={onClearFilters} style={{
                          padding: '11px 18px', borderRadius: 10, border: `1px solid ${T.border}`,
                          background: 'transparent', color: T.textMuted, fontSize: 13, fontWeight: 500
                        }}>
                          Clear
                        </button>
                    )}
                  </div>
                </div>
            )}
          </div>

          {/* Drill Banner */}
          {drillLabel && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
                background: `${T.blue}18`, borderBottom: `1px solid ${T.blue}40`,
                fontSize: 11, color: T.blueLight, fontWeight: 600,
              }}>
                <Target size={12} color={T.blue}/>
                <span style={{ flex: 1 }}>{drillLabel}</span>
                <button onClick={onClearFilters} style={{
                  background: 'transparent', border: `1px solid ${T.blue}60`, borderRadius: 5,
                  color: T.blue, fontSize: 10, fontWeight: 600, padding: '2px 8px', cursor: 'pointer',
                }}>Clear</button>
              </div>
          )}

          {/* Poll List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {visiblePolls.length === 0 ? (
                <EmptyState
                    icon={Activity}
                    title={polls.length === 0 ? 'No audit events' : 'All polls are empty'}
                    description={polls.length === 0 ? 'No changes found. Try adjusting filters or sync data.' : 'Every poll on this page recorded zero changes. Toggle "Hide polls with no changes" off to see them.'}
                />
            ) : (
                <>
                  <div role="listbox" aria-label="Audit polls">
                    {visiblePolls.map((poll, i) => (
                        <PollCard
                            key={poll.poll_id}
                            poll={poll}
                            pollNumber={poll.poll_number ?? Math.max(1, pollTotal - pollOffset - i)}
                            isSelected={selectedPoll?.poll_id === poll.poll_id}
                            onClick={() => { onSelectPoll(poll); if (onSelectLog) onSelectLog(null); }}
                        />
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0 16px' }}>
                    <button
                        onClick={() => onPollPageChange(pollOffset - POLLS_PAGE_SIZE)}
                        disabled={pollOffset === 0}
                        style={{
                          padding: '9px 12px', borderRadius: 10, border: `1px solid ${T.border}`,
                          background: pollOffset === 0 ? T.bgSurface : T.card,
                          color: pollOffset === 0 ? T.textDim : T.text, fontSize: 12, fontWeight: 600,
                          cursor: pollOffset === 0 ? 'not-allowed' : 'pointer'
                        }}
                    >
                      Previous
                    </button>
                    <div className="num" style={{ fontSize: 12, color: T.textMuted }}>
                      Page {Math.floor(pollOffset / POLLS_PAGE_SIZE) + 1} · {pluralize(pollTotal, 'poll')}
                    </div>
                    <button
                        onClick={() => onPollPageChange(pollOffset + POLLS_PAGE_SIZE)}
                        disabled={pollOffset + POLLS_PAGE_SIZE >= pollTotal}
                        style={{
                          padding: '9px 12px', borderRadius: 10, border: `1px solid ${T.border}`,
                          background: pollOffset + POLLS_PAGE_SIZE >= pollTotal ? T.bgSurface : T.card,
                          color: pollOffset + POLLS_PAGE_SIZE >= pollTotal ? T.textDim : T.text, fontSize: 12, fontWeight: 600,
                          cursor: pollOffset + POLLS_PAGE_SIZE >= pollTotal ? 'not-allowed' : 'pointer'
                        }}
                    >
                      Next
                    </button>
                  </div>
                </>
            )}
          </div>
        </div>

        <ResizeHandle onMouseDown={pollsPanel.handleMouseDown}/>

        {/* Changes Panel */}
        <div className="pane" style={{ width: isNarrow ? '100%' : changesPanel.width, minHeight: isNarrow ? 280 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
          {drillLabel && selectedPoll ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${T.border}`, background: T.card, flexShrink: 0 }}>
                  <button onClick={() => { onSelectPoll(null); if (onSelectLog) onSelectLog(null); }} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                    borderRadius: 7, border: `1px solid ${T.blue}50`, background: T.blueDim,
                    color: T.blue, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>
                    <ChevronLeft size={12}/> All Changes
                  </button>
                  <span className="num" style={{ fontSize: 11, color: T.textMuted }}>
                Poll #{selectedPoll.poll_number ?? '—'} · {fmtDate(selectedPoll.poll_timestamp, 'card')}
              </span>
                </div>
                <PollChangesPanel poll={selectedPoll} selectedLog={selectedLog} onSelectLog={onSelectLog} presetPollActionDisplay={pollPresetDisplayAction}/>
              </>
          ) : drillLabel ? (
              <MergedChangesPanel drillLabel={drillLabel} filters={filters} resolveUser={resolveUser} onSelectLog={onSelectLog} selectedLog={selectedLog}/>
          ) : selectedPoll ? (
              <PollChangesPanel poll={selectedPoll} selectedLog={selectedLog} onSelectLog={onSelectLog} resolveUser={resolveUser} presetPollActionDisplay={pollPresetDisplayAction}/>
          ) : (
              <EmptyState icon={Target} title="Select a Poll" description="Pick a poll on the left, or use the sidebar metrics to load a merged view. Tip: use ↑/↓ to move between polls."/>
          )}
        </div>

        <ResizeHandle onMouseDown={changesPanel.handleMouseDown}/>

        {/* Diff Panel */}
        <div className="pane" style={{ flex: 1, minHeight: isNarrow ? 320 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bgSurface }}>
          {selectedLog ? (
              <DiffDetailView log={selectedLog} resolveUser={resolveUser}/>
          ) : (
              <EmptyState icon={GitBranch} title="View Diff" description="Select a change to see the detailed diff comparison."/>
          )}
        </div>
      </div>
  );
}

const selectStyle = (hasValue) => ({
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${hasValue ? T.blue : T.border}`,
  background: T.bgSurface, color: T.text, fontSize: 13
});

// Function (not a frozen object) so it reads the active theme via the Proxy.
const inputStyle = () => ({
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.border}`, background: T.bgSurface, color: T.text, fontSize: 13
});

function FilterField({ label, icon: Icon, color, children, inline }) {
  return (
      <div style={{ marginTop: inline ? 0 : 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
          <Icon size={12} color={color}/> {label}
        </label>
        {children}
      </div>
  );
}

function PollCard({ poll, pollNumber, isSelected, onClick }) {
  // Default-expanded: the action breakdown is the point of the card; hiding it
  // behind a click was the #1 confusing-UX complaint.
  const [expanded, setExpanded] = useState(true);
  const isRunning = poll.status === 'running';
  const isFailed = poll.status === 'failed';
  const changeCount = poll.total_changes || 0;
  const hasChanges = changeCount > 0;
  const isEmpty = !isRunning && !hasChanges;

  // Meaningful status dot/accent (no more decorative rainbow):
  //   running → yellow · failed → red · has changes → blue · empty → muted
  const accentColor = isRunning ? T.yellow : isFailed ? T.red : hasChanges ? T.blue : T.textDim;
  const source = poll.source === 'auto' ? 'Auto Sync' : poll.source === 'historical' ? 'Historical Data' : 'Manual Sync';

  const folderNames = useMemo(() => Object.keys(poll.folders || {}), [poll]);

  const displayedActionSummary = useMemo(() => {
    const summary = {};
    Object.values(poll.folders || {}).forEach(data => {
      (data.changes || []).forEach(log => {
        const key = displayActionKey(log);
        summary[key] = (summary[key] || 0) + 1;
      });
    });
    return Object.keys(summary).length ? summary : (poll.actions_summary || {});
  }, [poll]);

  return (
      <div
          role="option"
          aria-selected={isSelected}
          tabIndex={0}
          onClick={onClick}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
          className={`poll-card${isEmpty ? ' dimmed' : ''}`}
          style={{
            width: '100%', padding: 16, marginBottom: 12, borderRadius: 14,
            background: isSelected ? `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}08 100%)` : T.bgSurface,
            border: `2px solid ${isSelected ? accentColor : T.border}`,
            textAlign: 'left', cursor: 'pointer',
            boxShadow: isSelected ? `0 8px 32px ${accentColor}25` : 'none',
            transition: 'all .2s ease'
          }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: hasChanges ? 12 : 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span title={isRunning ? 'Running' : isFailed ? 'Failed' : hasChanges ? 'Completed with changes' : 'Completed, no changes'}
                  style={{ width: 8, height: 8, borderRadius: 4, background: accentColor, flexShrink: 0, animation: isRunning ? 'pulse 2s infinite' : 'none' }}/>
              <span className="num" style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Poll #{pollNumber}</span>
              <Badge size="xs" color={accentColor}>{isRunning ? `${source} · running` : source}</Badge>
              <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setExpanded(prev => !prev); }}
                  title={expanded ? 'Collapse details' : 'Expand details'}
                  aria-label={expanded ? 'Collapse details' : 'Expand details'}
                  style={{
                    width: 22, height: 22, borderRadius: 6, border: `1px solid ${T.border}`,
                    background: expanded ? `${accentColor}20` : 'transparent',
                    color: expanded ? accentColor : T.textMuted,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                  }}
              >
                {expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
              </button>
            </div>
            <div className="num" style={{ fontSize: 12, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
              <Clock size={11}/> {fmtDate(poll.poll_timestamp, 'card')}
            </div>
          </div>
          <div style={{
            padding: '5px 12px', borderRadius: 20, flexShrink: 0,
            background: hasChanges || isRunning ? `linear-gradient(135deg, ${accentColor}25 0%, ${accentColor}10 100%)` : T.bgAlt,
            border: `1px solid ${hasChanges || isRunning ? `${accentColor}40` : T.border}`
          }}>
            <span className="num" style={{ fontSize: 14, fontWeight: 700, color: accentColor }}>{isRunning ? '…' : changeCount}</span>
            <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 4 }}>{isRunning ? 'running' : (changeCount === 1 ? 'change' : 'changes')}</span>
          </div>
        </div>

        {/* Inline content preview (always visible when there are changes) */}
        {hasChanges && !expanded && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginLeft: 16 }}>
              {folderNames.slice(0, 2).map(path => {
                const leaf = path.split(' > ').pop();
                return (
                    <span key={path} title={path} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: T.textMuted,
                      background: T.bgAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: '2px 7px',
                      maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                <Folder size={9} color={T.yellow}/> {leaf}
              </span>
                );
              })}
              {folderNames.length > 2 && (
                  <span className="num" style={{ fontSize: 10, color: T.textDim }}>+{folderNames.length - 2} folders</span>
              )}
            </div>
        )}

        {/* Expanded: action summary chips */}
        {expanded && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {Object.entries(displayedActionSummary).map(([action, count]) => {
                const cfg = actionConfig(action);
                if (!cfg) return null;
                const Icon = cfg.icon;
                return (
                    <div key={action} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px',
                      background: cfg.bg, borderRadius: 8, border: `1px solid ${cfg.c}30`
                    }}>
                      <Icon size={11} color={cfg.c}/>
                      <span className="num" style={{ fontSize: 11, fontWeight: 600, color: cfg.c }}>{count}</span>
                      <span style={{ fontSize: 10, color: cfg.c, opacity: .85 }}>{cfg.label}</span>
                    </div>
                );
              })}
            </div>
        )}
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MERGED CHANGES PANEL — aggregated audit log view for sidebar drills
═══════════════════════════════════════════════════════════════════ */
function MergedChangesPanel({ drillLabel, filters, resolveUser, onSelectLog, selectedLog }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const PAGE = 40;
  const abortRef = useRef(null);

  const fetchEntries = useCallback(async (off = 0) => {
    // Cancel any in-flight request so out-of-order responses can't clobber state.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      let url = `/logs?limit=${PAGE}&offset=${off}`;
      if (filters.audit_action) url += `&audit_action=${encodeURIComponent(filters.audit_action)}`;
      if (filters.from) url += `&from=${encodeURIComponent(filters.from)}`;
      if (filters.to) url += `&to=${encodeURIComponent(filters.to)}`;
      if (filters.actor) url += `&actor=${encodeURIComponent(filters.actor)}`;
      if (filters.folder) url += `&folder=${encodeURIComponent(filters.folder)}`;
      const data = await apiFetch(url, { signal: controller.signal });
      setEntries(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      setTotal(data?.total ?? (Array.isArray(data) ? data.length : 0));
    } catch (e) {
      if (!isAbortError(e)) console.error('MergedChangesPanel:', e);
    } finally {
      if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
    }
  }, [filters]);

  // Debounce filter changes (250ms) and abort the request on unmount/refilter.
  useEffect(() => {
    const id = setTimeout(() => { setOffset(0); fetchEntries(0); }, 250);
    return () => { clearTimeout(id); abortRef.current?.abort(); };
  }, [fetchEntries]);

  const totalPages = Math.ceil(total / PAGE);
  const currentPage = Math.floor(offset / PAGE) + 1;

  return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${T.border}`, background: T.card, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: T.blueDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ListChecks size={16} color={T.blue}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Merged Changes</div>
              <div style={{ fontSize: 10, color: T.textDim, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drillLabel}</div>
            </div>
            {!loading && (
                <div className="num" style={{ padding: '4px 10px', borderRadius: 20, background: T.blueDim, fontSize: 11, fontWeight: 700, color: T.blue, flexShrink: 0 }}>
                  {pluralize(total, 'change')}
                </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
              <div style={{ padding: 12 }}>{[0, 1, 2, 3, 4].map(i => <SkeletonCard key={i} height={56}/>)}</div>
          ) : entries.length === 0 ? (
              <EmptyState icon={Activity} title="No changes found" description="No audit log entries match the selected filter."/>
          ) : (
              entries.map((log, i) => {
                const cfg = actionConfig(log);
                const Icon = cfg.icon;
                const actor = resolveUser(log.actor_name, log.actor_account);
                const isSel = selectedLog?.id && selectedLog.id === log.id;
                return (
                    <button
                        key={log.id || i}
                        type="button"
                        onClick={() => onSelectLog?.(log)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                          padding: '10px 14px', background: isSel ? T.blueDim : 'transparent', border: 'none',
                          borderLeft: `3px solid ${isSel ? T.blue : 'transparent'}`,
                          borderBottom: `1px solid ${T.borderLight}`, textAlign: 'left', cursor: 'pointer',
                          transition: 'background .12s',
                        }}
                        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = T.cardHover; }}
                        onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: cfg.bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                        <Icon size={13} color={cfg.c}/>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                      {log.name || log.zephyr_key}
                    </span>
                          <Badge size="xs" color={cfg.c}>{cfg.label}</Badge>
                          {log.zephyr_key && <span style={{ fontSize: 9, color: T.textDim, fontFamily: 'monospace' }}>{log.zephyr_key}</span>}
                        </div>
                        <div style={{ fontSize: 10, color: T.textMuted, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {actor && actor !== 'Unassigned' && <span><User size={9} style={{ verticalAlign: 'middle' }}/> {actor}</span>}
                          {(log.folder_after || log.folder_before) && (
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                        <Folder size={9} style={{ verticalAlign: 'middle' }}/> {log.folder_after || log.folder_before}
                      </span>
                          )}
                          {log.detected_at && <span className="num"><Clock size={9} style={{ verticalAlign: 'middle' }}/> {fmtDate(log.detected_at, 'card')}</span>}
                        </div>
                      </div>
                    </button>
                );
              })
          )}
        </div>

        {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: `1px solid ${T.border}`, background: T.card, flexShrink: 0 }}>
              <button onClick={() => { const o = Math.max(0, offset - PAGE); setOffset(o); fetchEntries(o); }} disabled={offset === 0}
                      style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: offset === 0 ? T.bgSurface : T.cardHover, color: offset === 0 ? T.textDim : T.text, fontSize: 11, fontWeight: 600, cursor: offset === 0 ? 'not-allowed' : 'pointer' }}>
                Previous
              </button>
              <span className="num" style={{ fontSize: 11, color: T.textMuted }}>Page {currentPage} of {totalPages}</span>
              <button onClick={() => { const o = offset + PAGE; setOffset(o); fetchEntries(o); }} disabled={offset + PAGE >= total}
                      style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: offset + PAGE >= total ? T.bgSurface : T.cardHover, color: offset + PAGE >= total ? T.textDim : T.text, fontSize: 11, fontWeight: 600, cursor: offset + PAGE >= total ? 'not-allowed' : 'pointer' }}>
                Next
              </button>
            </div>
        )}
      </div>
  );
}

function PollChangesPanel({ poll, selectedLog, onSelectLog, resolveUser, presetPollActionDisplay }) {
  const time = new Date(poll.poll_timestamp);
  const folderEntries = Object.entries(poll.folders || {});
  const [actionFilter, setActionFilter] = useState(null);
  const [actorFilter, setActorFilter] = useState(null);
  const isRunning = poll.status === 'running';
  const sourceLabel = poll.source === 'auto' ? 'Auto sync' : poll.source === 'historical' ? 'Historical Data' : 'Manual sync';

  useEffect(() => { setActionFilter(presetPollActionDisplay ?? null); }, [presetPollActionDisplay, poll?.poll_id]);

  const actorOptions = useMemo(() => {
    const map = new Map();
    folderEntries.forEach(([, data]) => {
      (data.changes || []).forEach(log => {
        const id = log.actor_account || log.actor_name || 'unknown';
        if (!map.has(id)) map.set(id, { id, label: auditActorName(log, resolveUser), count: 0 });
        map.get(id).count += 1;
      });
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [folderEntries, resolveUser]);

  const displayedActionSummary = useMemo(() => {
    const summary = {};
    folderEntries.forEach(([, data]) => {
      (data.changes || []).forEach(log => {
        const key = displayActionKey(log);
        summary[key] = (summary[key] || 0) + 1;
      });
    });
    return summary;
  }, [folderEntries]);

  const filteredFolderEntries = useMemo(() => {
    return folderEntries
        .map(([folderPath, data]) => [folderPath, {
          ...data,
          changes: (data.changes || []).filter(log => {
            const matchesAction = !actionFilter || displayActionKey(log) === actionFilter;
            const matchesActor = !actorFilter || (log.actor_account || log.actor_name || 'unknown') === actorFilter;
            return matchesAction && matchesActor;
          })
        }])
        .filter(([, data]) => (data.changes || []).length > 0);
  }, [folderEntries, actionFilter, actorFilter]);

  const visibleTotal = actionFilter || actorFilter
      ? filteredFolderEntries.reduce((sum, [, data]) => sum + (data.changes || []).length, 0)
      : poll.total_changes;
  const folderCount = folderEntries.length;

  return (
      <>
        <div style={{ padding: 20, borderBottom: `1px solid ${T.border}`, background: T.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: T.gradPurple, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GitCommit size={22} color="#fff"/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{isRunning ? 'Poll In Progress' : 'Poll Changes'}</div>
              <div className="num" style={{ fontSize: 13, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <Clock size={12}/> {fmtDate(time, 'detail')}
              </div>
            </div>
            {isRunning && <Badge size="sm" color={T.yellow}>Running</Badge>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <button onClick={() => setActionFilter(null)} style={{
              padding: '10px 12px', background: !actionFilter ? T.purpleDim : T.bgSurface, borderRadius: 10,
              textAlign: 'center', border: `1px solid ${!actionFilter ? T.purple : T.border}40`
            }}>
              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: isRunning ? T.yellow : T.purple }}>{isRunning ? '…' : poll.total_changes}</div>
              <div style={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase' }}>{isRunning ? 'Running' : 'Total'}</div>
            </button>
            {Object.entries(displayedActionSummary).slice(0, 3).map(([action, count]) => {
              const cfg = actionConfig(action);
              if (!cfg) return null;
              return (
                  <button key={action} onClick={() => setActionFilter(prev => prev === action ? null : action)} style={{
                    padding: '10px 12px', background: cfg.bg, borderRadius: 10, textAlign: 'center',
                    border: `1px solid ${actionFilter === action ? cfg.c : `${cfg.c}20`}`,
                    boxShadow: actionFilter === action ? `0 0 0 2px ${cfg.c}20` : 'none'
                  }}>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, color: cfg.c }}>{count}</div>
                    <div style={{ fontSize: 10, color: cfg.c, textTransform: 'uppercase', opacity: 0.8 }}>{cfg.label}</div>
                  </button>
              );
            })}
          </div>
          {actionFilter && (
              <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted }}>
                Showing <strong style={{ color: actionConfig(actionFilter)?.c }}>{visibleTotal}</strong> {actionConfig(actionFilter)?.label.toLowerCase()} {visibleTotal === 1 ? 'change' : 'changes'}. Click Total to clear.
              </div>
          )}
          {actorFilter && !actionFilter && (
              <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted }}>
                Showing <strong style={{ color: T.purple }}>{visibleTotal}</strong> {visibleTotal === 1 ? 'change' : 'changes'} by {actorOptions.find(actor => actor.id === actorFilter)?.label || 'selected user'}.
              </div>
          )}
          {actorOptions.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: T.textDim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Modified by</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {actorOptions.map(actor => {
                    const active = actorFilter === actor.id;
                    return (
                        <button key={actor.id} onClick={() => setActorFilter(prev => prev === actor.id ? null : actor.id)} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 10,
                          border: `1px solid ${active ? T.purple : T.border}`, background: active ? T.purpleDim : T.bgSurface, color: T.text, cursor: 'pointer'
                        }}>
                          <div style={{ width: 22, height: 22, borderRadius: 7, background: T.gradPurple, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 800 }}>
                            {actor.label.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{actor.label}</span>
                          <span className="num" style={{ fontSize: 11, color: T.textMuted }}>{actor.count}</span>
                        </button>
                    );
                  })}
                </div>
              </div>
          )}
          {poll.total_changes > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, color: T.textMuted }}>
                {pluralize(poll.total_changes, 'change')} across {pluralize(folderCount, 'folder')}.
              </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {filteredFolderEntries.length === 0 ? (
              isRunning ? (
                  <SyncProgressState poll={poll} sourceLabel={sourceLabel}/>
              ) : (
                  <EmptyState
                      icon={CheckCircle2}
                      title="No changes in this poll"
                      description={poll.total_fetched ? `${poll.total_fetched} cases fetched, ${poll.unchanged_count || poll.total_fetched} unchanged.` : 'This sync completed without creating audit log changes.'}
                  />
              )
          ) : (
              filteredFolderEntries.map(([folderPath, data]) => (
                  <FolderGroup key={`${actionFilter || 'all'}-${folderPath}`} folderPath={folderPath} data={data} selectedLog={selectedLog} onSelectLog={onSelectLog} resolveUser={resolveUser}/>
              ))
          )}
        </div>
      </>
  );
}

function SyncProgressState({ poll, sourceLabel }) {
  return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <div style={{ width: '100%', maxWidth: 420, padding: 28, borderRadius: 18, background: T.card, border: `1px solid ${T.yellow}30`, textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: T.yellowDim, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', animation: 'pulse 2s infinite' }}>
            <RefreshCw size={26} color={T.yellow}/>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 8 }}>Sync in progress</div>
          <div className="num" style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, marginBottom: 18 }}>
            {sourceLabel} started at {fmtDate(poll.poll_timestamp, 'time')}. Changes will appear here as soon as the poller completes.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 12, background: T.bgSurface, border: `1px solid ${T.border}` }}>
              <div className="num" style={{ fontSize: 18, fontWeight: 800, color: T.blue }}>{poll.total_fetched || '-'}</div>
              <div style={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase' }}>Fetched so far</div>
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: T.bgSurface, border: `1px solid ${T.border}` }}>
              <div className="num" style={{ fontSize: 18, fontWeight: 800, color: T.green }}>{poll.unchanged_count || '-'}</div>
              <div style={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase' }}>Unchanged so far</div>
            </div>
          </div>
        </div>
      </div>
  );
}

function FolderGroup({ folderPath, data, selectedLog, onSelectLog, resolveUser }) {
  // Open by default so changes are visible without an extra click.
  const [isOpen, setIsOpen] = useState(true);
  
  const changes = useMemo(() => data.changes || [], [data.changes]);
  const pathParts = folderPath.split(' > ');
  const folderName = pathParts.pop();
  const parentPath = pathParts.length > 0 ? pathParts.join(' > ') : null;

  // Auto-open the group that contains the currently selected change
  useEffect(() => {
    if (selectedLog && changes.some(c => c.id === selectedLog.id)) setIsOpen(true);
  }, [selectedLog, changes]);

  return (
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setIsOpen(!isOpen)} style={{
          width: '100%', padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: isOpen ? T.card : T.bgSurface, borderRadius: 12,
          border: `1px solid ${isOpen ? T.yellow : T.border}30`, cursor: 'pointer', transition: 'all .2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: T.yellowDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isOpen ? <FolderOpen size={16} color={T.yellow}/> : <Folder size={16} color={T.yellow}/>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folderName}</div>
              {parentPath && <div style={{ fontSize: 11, color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{parentPath}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="num" style={{ padding: '4px 12px', borderRadius: 12, background: T.purpleDim, border: `1px solid ${T.purple}30`, fontSize: 13, fontWeight: 700, color: T.purple }}>
              {changes.length}
            </div>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: T.bgSurface, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isOpen ? <ChevronUp size={14} color={T.textDim}/> : <ChevronDown size={14} color={T.textDim}/>}
            </div>
          </div>
        </button>

        {isOpen && changes.length > 0 && (
            <div style={{ marginTop: 8, marginLeft: 20, borderLeft: `2px solid ${T.border}`, paddingLeft: 16 }}>
              {changes.map((log, i) => (
                  <ChangeItem key={log.id || i} log={log} isSelected={selectedLog?.id === log.id} onClick={() => onSelectLog(log)} resolveUser={resolveUser}/>
              ))}
            </div>
        )}
      </div>
  );
}

function ChangeItem({ log, isSelected, onClick, resolveUser }) {
  const cfg = actionConfig(log);
  const Icon = cfg.icon;
  const userName = auditActorName(log, resolveUser);

  return (
      <button onClick={onClick} style={{
        width: '100%', padding: 14, marginBottom: 8, borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 14,
        background: isSelected ? `linear-gradient(135deg, ${T.blue}15 0%, ${T.blue}05 100%)` : T.bgSurface,
        border: `2px solid ${isSelected ? T.blue : 'transparent'}`, cursor: 'pointer', textAlign: 'left',
        boxShadow: isSelected ? `0 4px 16px ${T.blue}20` : 'none', transition: 'all .15s ease'
      }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: cfg.bg, border: `1px solid ${cfg.c}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={cfg.c}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.blue, fontFamily: 'ui-monospace, monospace' }}>{log.zephyr_key}</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: cfg.bg, color: cfg.c, fontWeight: 600, textTransform: 'uppercase' }}>{cfg.label}</span>
          </div>
          <div style={{ fontSize: 13, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {log.diff_after?.name || log.diff_before?.name || 'Unnamed test case'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>Modified by</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <User size={12} color={T.purple}/>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{userName}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {log.changed_fields?.length > 0 && <span className="num" style={{ fontSize: 10, color: T.teal, fontWeight: 600 }}>{log.changed_fields.length} fields</span>}
            <span className="num" style={{ fontSize: 10, color: T.textDim }}>{fmtDate(log.detected_at, 'time')}</span>
          </div>
        </div>
      </button>
  );
}

function auditActorName(log, resolveUser) {
  if (!log?.actor_name && !log?.actor_account) return 'Unknown Modifier';
  const resolved = resolveUser(log.actor_name, log.actor_account);
  return resolved === 'Unassigned' ? 'Unknown Modifier' : resolved;
}

/* ═══════════════════════════════════════════════════════════════════
   DIFF DETAIL VIEW
═══════════════════════════════════════════════════════════════════ */
function DiffDetailView({ log, resolveUser }) {
  const cfg = actionConfig(log);
  const Icon = cfg.icon;
  const userName = auditActorName(log, resolveUser);

  const changes = useMemo(() => buildStructuredChanges(log.diff_before || {}, log.diff_after || {}, resolveUser), [log, resolveUser]);

  const hasFolderMove = Boolean(log.folder_before && log.folder_after && log.folder_before !== log.folder_after);
  const isDeleted = log.action === 'DELETED';
  const isMovedIntoScope = isScopeReturn(log);
  const changedCount = isDeleted ? 1 : (log.changed_fields?.length ?? changes.length);

  return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: 20, borderBottom: `1px solid ${T.border}`, background: T.card }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <Badge size="md" color="#fff" gradient={cfg.gradient} icon={Icon}>{cfg.label}</Badge>
                <span style={{ fontSize: 20, fontWeight: 700, color: T.blue, fontFamily: 'ui-monospace, monospace' }}>{log.zephyr_key}</span>
              </div>
              <div style={{ fontSize: 14, color: T.text, marginBottom: 10 }}>
                {log.diff_after?.name || log.diff_before?.name || 'Unnamed test case'}
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.textSecondary }}>
                <User size={14} color={T.purple}/> Modified by <strong>{userName}</strong>
              </span>
                <span className="num" style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.textMuted }}>
                <Clock size={14}/> {fmtDate(log.detected_at, 'detail')}
              </span>
              </div>
            </div>
            <Badge size="sm" color={T.blue} bg={T.blueDim} icon={List}>Structured Diff</Badge>
          </div>

          <div style={{ display: 'flex', gap: 12, padding: 14, background: T.bgSurface, borderRadius: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: T.purple }}/>
              <span style={{ fontSize: 13, color: T.text }}><strong className="num">{changedCount}</strong> {changedCount === 1 ? 'field' : 'fields'} changed</span>
            </div>
            {hasFolderMove && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: T.blue }}/>
                  <span style={{ fontSize: 13, color: T.text }}>Folder moved</span>
                </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {hasFolderMove && <FolderMoveCard from={log.folder_before} to={log.folder_after}/>}

          {isDeleted ? (
              <DeletedSummary log={log}/>
          ) : isMovedIntoScope ? (
              <MovedIntoScopeSummary log={log}/>
          ) : changes.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} color={T.yellow}/> Structured Changes
                </h3>
                {changes.map(change => <StructuredDiffBlock key={change.id} change={change}/>)}
              </div>
          ) : hasFolderMove ? (
              <OnlyFolderChanged log={log}/>
          ) : (
              <NoStructuredDiff log={log}/>
          )}
        </div>
      </div>
  );
}

function FolderMoveCard({ from, to }) {
  return (
      <div style={{ marginBottom: 24, padding: 20, background: T.blueDim, border: `1px solid ${T.blue}40`, borderRadius: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.blue, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Move size={18}/> Folder Changed
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160, padding: 14, background: T.redDim, border: `1px solid ${T.red}40`, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: T.red, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Previous</div>
            <FolderPath path={from}/>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}><ArrowRight size={24} color={T.textDim}/></div>
          <div style={{ flex: 1, minWidth: 160, padding: 14, background: T.greenDim, border: `1px solid ${T.green}40`, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: T.green, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>New</div>
            <FolderPath path={to}/>
          </div>
        </div>
      </div>
  );
}

function FolderPath({ path }) {
  if (!path) return <span style={{ color: T.textDim, fontSize: 13 }}>Unknown</span>;
  const parts = path.split(' > ');
  return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {parts.map((part, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, color: T.text, padding: '3px 8px', background: T.bgAlt, borderRadius: 6 }}>{part}</span>
              {i < parts.length - 1 && <ChevronRight size={12} color={T.textDim}/>}
        </span>
        ))}
      </div>
  );
}

function buildStructuredChanges(before, after, resolveUser) {
  const items = [];
  const push = (section, key, title, oldValue, newValue, type = 'field') => {
    const beforeText = readableValueForField(key, oldValue, resolveUser);
    const afterText = readableValueForField(key, newValue, resolveUser);
    if (beforeText === afterText) return;
    items.push({
      id: `${section}-${key}`, section, key, title,
      before: beforeText, after: afterText, type,
      status: !beforeText ? 'added' : !afterText ? 'removed' : 'modified'
    });
  };

  [
    ['summary', 'name', 'Title'],
    ['summary', 'status', 'Status'],
    ['summary', 'priority', 'Priority'],
    ['summary', 'owner', 'Owner'],
    ['summary', 'ownerAccountId', 'Owner Account'],
    ['summary', 'ownerName', 'Owner Name'],
    ['summary', 'assignee', 'Assignee'],
    ['summary', 'assigneeAccountId', 'Assignee Account'],
    ['summary', 'folderPath', 'Folder Path'],
    ['content', 'objective', 'Objective'],
    ['content', 'precondition', 'Precondition'],
    ['content', 'description', 'Description'],
    ['content', 'labels', 'Labels'],
  ].forEach(([section, key, title]) => push(section, key, title, before[key], after[key]));

  const beforeCustom = before.customFields || {};
  const afterCustom = after.customFields || {};
  [...new Set([...Object.keys(beforeCustom), ...Object.keys(afterCustom)])]
      .sort()
      .forEach(key => push('custom', key, formatFieldName(key), beforeCustom[key], afterCustom[key]));

  const beforeScript = normalizeScriptRows(before.testSteps || before.steps || before.script || before.testScript);
  const afterScript = normalizeScriptRows(after.testSteps || after.steps || after.script || after.testScript);
  const maxRows = Math.max(beforeScript.length, afterScript.length);
  for (let i = 0; i < maxRows; i++) push('steps', `step-${i}`, `Step ${i + 1}`, beforeScript[i], afterScript[i], 'step');

  return items;
}

function readableValueForField(key, value, resolveUser) {
  if (['owner', 'ownerAccountId', 'ownerName', 'assignee', 'assigneeAccountId'].includes(key)) {
    const user = userDisplayValue(value, resolveUser);
    if (user) return user;
  }
  return readableValue(value, resolveUser);
}

function userDisplayValue(value, resolveUser) {
  if (value === null || value === undefined || value === '') return '';
  if (!resolveUser) return '';
  if (typeof value === 'object') {
    const account = value.accountId || value.account_id || value.id || value.key;
    const name = value.displayName || value.name || value.emailAddress;
    return resolveUser(name, account);
  }
  return resolveUser(value);
}

function readableValue(value, resolveUser) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map(item => readableValue(item, resolveUser)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    if (value.name) return String(value.name);
    if (value.displayName) return String(value.displayName);
    if (value.accountId) return String(value.accountId);
    if (value.id && Object.keys(value).length <= 2) return String(value.id);
    return Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${formatFieldName(k)}: ${readableValue(v, resolveUser)}`)
        .join(NEWLINE);
  }
  return cleanDisplayText(String(value));
}

function cleanDisplayText(value) {
  return String(value)
      .replace(new RegExp('<br[^>]*>', 'gi'), NEWLINE)
      .replace(new RegExp('</(p|div|h[1-6]|li)>', 'gi'), NEWLINE)
      .replace(new RegExp('<[^>]*>', 'g'), '')
      .replace(new RegExp('&nbsp;', 'g'), ' ')
      .replace(new RegExp('&amp;', 'g'), '&')
      .replace(new RegExp('&lt;', 'g'), '<')
      .replace(new RegExp('&gt;', 'g'), '>')
      .replace(new RegExp('[ ' + TABCH + ']+' + NEWLINE, 'g'), NEWLINE)
      .replace(new RegExp(NEWLINE + '{3,}', 'g'), NEWLINE + NEWLINE)
      .trim();
}

function normalizeScriptRows(script) {
  if (!script) return [];
  const rows = Array.isArray(script) ? script : (script.steps || script.testSteps || script.inline?.steps || script.plainText || script.text || script);
  if (typeof rows === 'string') return [rows];
  if (!Array.isArray(rows)) return [readableValue(rows)].filter(Boolean);
  return rows.map((step) => {
    if (typeof step === 'string') return step;
    const inline = step.inline || step;
    const fields = [
      ['Description', inline.description || inline.action],
      ['Test Data', inline.testData || inline.data],
      ['Expected Result', inline.expectedResult || inline.expected || inline.result],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');
    return fields.length ? fields.map(([k, v]) => `${k}: ${readableValue(v)}`).join(NEWLINE) : readableValue(step);
  });
}

function NoStructuredDiff({ log }) {
  return (
      <div style={{ padding: 28, background: T.card, border: `1px solid ${T.border}`, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: T.yellowDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GitCommit size={20} color={T.yellow}/>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>No structured field body</div>
            <div style={{ fontSize: 13, color: T.textMuted }}>The audit log has a change, but there is no readable before/after body for the structured renderer.</div>
          </div>
        </div>
        {log.changed_fields?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: T.textDim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Changed fields reported by backend</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {log.changed_fields.map(field => <Badge key={field} size="xs" color={T.purple}>{formatFieldName(field)}</Badge>)}
              </div>
            </div>
        )}
      </div>
  );
}

function OnlyFolderChanged({ log }) {
  return (
      <div style={{ padding: 18, background: T.blueDim, border: `1px solid ${T.blue}30`, borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Move size={16} color={T.blue}/>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Only folder path changed</div>
        </div>
        <div style={{ fontSize: 13, color: T.textMuted }}>
          The readable folder diff is shown above. Backend fields: {(log.changed_fields || []).map(formatFieldName).join(', ') || 'folder path'}.
        </div>
      </div>
  );
}

function DeletedSummary({ log }) {
  const archivedFolder = log.folder_after || log.diff_after?.folderPath;
  return (
      <div style={{ padding: 18, background: T.redDim, border: `1px solid ${T.red}30`, borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Trash2 size={16} color={T.red}/>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{archivedFolder ? 'Moved to Archived' : 'Test case removed from monitored scope'}</div>
        </div>
        <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
          {archivedFolder
              ? 'This case moved from the configured parent folder into an Archived/Deprecated location.'
              : 'This entry records the case disappearing from the selected folders during this poll. Full previous snapshot fields are intentionally hidden so deleted cases do not look like every field was manually removed.'}
        </div>
        {log.folder_before && <div style={{ marginTop: 12, fontSize: 12, color: T.textSubtle }}>Previous folder: {log.folder_before}</div>}
        {archivedFolder && <div style={{ marginTop: 12, fontSize: 12, color: T.textSubtle }}>Archived folder: {archivedFolder}</div>}
      </div>
  );
}

function MovedIntoScopeSummary({ log }) {
  return (
      <div style={{ padding: 18, background: T.tealDim, border: `1px solid ${T.teal}30`, borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <RefreshCw size={16} color={T.teal}/>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Returned to monitored scope</div>
        </div>
        <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
          This case was previously outside the monitored folder scope and is now visible again in the selected audit folders. The audit event is shown as <strong style={{ color: T.teal }}>Moved In</strong> to distinguish it from a field-level edit.
        </div>
        {log.folder_after && <div style={{ marginTop: 12, fontSize: 12, color: T.textSubtle }}>Current folder: {log.folder_after}</div>}
      </div>
  );
}

function StructuredDiffBlock({ change }) {
  const [expanded, setExpanded] = useState(true);
  const statusColor = change.status === 'added' ? T.green : change.status === 'removed' ? T.red : T.yellow;
  const statusLabel = change.status === 'added' ? 'Added' : change.status === 'removed' ? 'Removed' : 'Modified';
  const SectionIcon = change.section === 'steps' ? ListChecks : change.section === 'custom' ? SlidersHorizontal : FileText;

  return (
      <div style={{ marginBottom: 14, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', background: T.card }}>
        <button onClick={() => setExpanded(!expanded)} style={{
          width: '100%', padding: '14px 16px', background: T.card, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <SectionIcon size={16} color={statusColor}/>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{change.title}</div>
              <div style={{ fontSize: 11, color: T.textDim, textTransform: 'uppercase' }}>{change.section}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge size="xs" color={statusColor}>{statusLabel}</Badge>
            {expanded ? <ChevronUp size={14} color={T.textDim}/> : <ChevronDown size={14} color={T.textDim}/>}
          </div>
        </button>

        {expanded && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderTop: `1px solid ${T.border}` }}>
              <StructuredValue title="Before" value={change.before} otherValue={change.after} tone="before"/>
              <StructuredValue title="After" value={change.after} otherValue={change.before} tone="after"/>
            </div>
        )}
      </div>
  );
}

function StructuredValue({ title, value, otherValue, tone }) {
  const isBefore = tone === 'before';
  const diff = useMemo(() => {
    if (!value || !otherValue) return null;
    const result = computeWordDiff(isBefore ? value : otherValue, isBefore ? otherValue : value);
    return isBefore ? result.old : result.new;
  }, [value, otherValue, isBefore]);

  return (
      <div style={{ padding: 14, background: isBefore ? T.redDim : T.greenDim, borderRight: isBefore ? `1px solid ${T.border}` : 'none', minHeight: 76 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: isBefore ? T.red : T.green, textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
        {value ? (
            <div style={{ fontSize: 13, color: T.textSecondary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {diff ? diff.map((part, i) => {
                const isChanged = part.type === (isBefore ? 'del' : 'add');
                return (
                    <span key={i} style={{
                      color: isChanged ? T.text : T.textMuted,
                      background: isChanged ? (isBefore ? `${T.red}35` : `${T.green}35`) : 'transparent',
                      borderRadius: isChanged ? 4 : 0, padding: isChanged ? '1px 2px' : 0, fontWeight: isChanged ? 700 : 400
                    }}>{part.text}</span>
                );
              }) : value}
            </div>
        ) : (
            <div style={{ fontSize: 13, color: T.textDim, fontStyle: 'italic' }}>empty</div>
        )}
      </div>
  );
}

// Word-level diff for highlighting changes within text
function computeWordDiff(oldText, newText) {
  if (!oldText && !newText) return { old: [], new: [] };
  if (!oldText) return { old: [], new: [{ text: newText, type: 'add' }] };
  if (!newText) return { old: [{ text: oldText, type: 'del' }], new: [] };

  const oldWords = String(oldText).split(/(\s+)/);
  const newWords = String(newText).split(/(\s+)/);
  const m = oldWords.length, n = newWords.length;

  // Guard: the LCS DP is O(m*n) in time AND memory. For very large blobs
  // (e.g. a full test-script rewrite) that can allocate millions of cells and
  // jank the main thread. Fall back to a coarse whole-value replacement.
  if (m * n > 250000 || String(oldText).length > 20000 || String(newText).length > 20000) {
    return { old: [{ text: oldText, type: 'del' }], new: [{ text: newText, type: 'add' }] };
  }

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldWords[i - 1] === newWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = m, j = n;
  const lcsWords = [];
  while (i > 0 && j > 0) {
    if (oldWords[i - 1] === newWords[j - 1]) { lcsWords.unshift({ word: oldWords[i - 1], oi: i - 1, ni: j - 1 }); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--; else j--;
  }

  const oldResult = [], newResult = [];
  let oi = 0, ni = 0, li = 0;
  while (oi < m || ni < n) {
    if (li < lcsWords.length && oi === lcsWords[li].oi && ni === lcsWords[li].ni) {
      oldResult.push({ text: oldWords[oi], type: 'same' });
      newResult.push({ text: newWords[ni], type: 'same' });
      oi++; ni++; li++;
    } else {
      if (oi < m && (li >= lcsWords.length || oi < lcsWords[li].oi)) { oldResult.push({ text: oldWords[oi], type: 'del' }); oi++; }
      if (ni < n && (li >= lcsWords.length || ni < lcsWords[li].ni)) { newResult.push({ text: newWords[ni], type: 'add' }); ni++; }
    }
  }
  return { old: oldResult, new: newResult };
}

function formatFieldName(key) {
  return String(key).replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim();
}

/* ═══════════════════════════════════════════════════════════════════
   TEST REPOSITORY VIEW
═══════════════════════════════════════════════════════════════════ */
function TestRepositoryView({ folders, testCases, selectedFolder, onSelectFolder, selectedTestCase, onSelectTestCase, search, onSearch, offset, onPageChange, resolveUser, drillLabel, onClearDrill, isNarrow }) {
  const [searchInput, setSearchInput] = useState(search);
  const [folderSearch, setFolderSearch] = useState('');
  const [detailVisible, setDetailVisible] = useSessionState('testRepo_detailVisible', false);
  const folderPanel = useResizable(300, 220, 450);
  const listPanel = useResizable(450, 300, 700);

  const folderTree = useMemo(() => {
    const map = {};
    folders.forEach(f => { map[f.folder_id] = { ...f, children: [], _directCount: f.test_case_count || 0 }; });
    const roots = [];
    folders.forEach(f => {
      if (f.parent_id && map[f.parent_id]) map[f.parent_id].children.push(map[f.folder_id]);
      else roots.push(map[f.folder_id]);
    });
    // Pure post-order: returns NEW nodes with aggregated counts instead of
    // mutating the in-progress tree.
    const withCounts = (node) => {
      const children = (node.children || []).map(withCounts);
      const total = (node._directCount || 0) + children.reduce((s, c) => s + c.test_case_count, 0);
      return { ...node, children, test_case_count: total };
    };
    const sortRec = (n) => ({
      ...n,
      children: [...(n.children || [])].sort((a, b) => a.name.localeCompare(b.name)).map(sortRec),
    });
    const builtRoots = roots.map(withCounts).map(sortRec).sort((a, b) => a.name.localeCompare(b.name));
    const total = builtRoots.reduce((s, r) => s + (r.test_case_count || 0), 0);
    return builtRoots.length === 1 ? builtRoots[0] : { name: 'All Test Cases', folder_id: null, children: builtRoots, test_case_count: total };
  }, [folders]);

  const filterFolders = useCallback((node, term) => {
    if (!term) return node;
    const lowTerm = term.toLowerCase();
    const matchesSelf = node.name?.toLowerCase().includes(lowTerm);
    const filteredChildren = node.children?.map(c => filterFolders(c, term)).filter(Boolean) || [];
    if (matchesSelf || filteredChildren.length > 0) return { ...node, children: filteredChildren };
    return null;
  }, []);

  const filteredFolderTree = useMemo(() => filterFolders(folderTree, folderSearch) || folderTree, [folderTree, folderSearch, filterFolders]);

  const handleSearch = () => onSearch(searchInput);
  const totalPages = Math.ceil((testCases.total || 0) / 40);
  const currentPage = Math.floor(offset / 40) + 1;
  const totalCases = folders.reduce((s, f) => s + (f.test_case_count || 0), 0);

  return (
      <div className="pane-row" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Folders */}
        <div className="pane" style={{ width: isNarrow ? '100%' : folderPanel.width, minHeight: isNarrow ? 220 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bgAlt, borderRight: `1px solid ${T.border}` }}>
          <div style={{ padding: 16, borderBottom: `1px solid ${T.border}`, background: T.card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: T.gradPurple, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Folder size={18} color="#fff"/>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Test Cases</div>
                <div className="num" style={{ fontSize: 12, color: T.textMuted }}>{totalCases.toLocaleString()} total</div>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textDim }}/>
              <input
                  value={folderSearch} onChange={e => setFolderSearch(e.target.value)} placeholder="Search folders..."
                  aria-label="Search folders"
                  style={{ width: '100%', padding: '9px 12px 9px 34px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgSurface, color: T.text, fontSize: 13 }}
              />
              {folderSearch && (
                  <button onClick={() => setFolderSearch('')} aria-label="Clear folder search"
                          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer', padding: 4 }}>
                    <X size={12}/>
                  </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            <FolderTree node={filteredFolderTree} depth={0} selected={selectedFolder} onSelect={onSelectFolder} searchTerm={folderSearch}/>
          </div>
        </div>

        <ResizeHandle onMouseDown={folderPanel.handleMouseDown}/>

        {/* Test List */}
        <div className="pane" style={{ width: isNarrow ? '100%' : (detailVisible ? listPanel.width : 'auto'), minHeight: isNarrow ? 280 : 0, flex: !isNarrow && detailVisible ? 'none' : 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
          <div style={{ padding: 12, borderBottom: `1px solid ${T.border}`, background: T.card, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim }}/>
              <input
                  value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search test cases..." aria-label="Search test cases"
                  style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgSurface, color: T.text, fontSize: 13 }}
              />
            </div>
            <button onClick={handleSearch} style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: T.gradBlue, color: '#fff', fontSize: 13, fontWeight: 600 }}>Search</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {drillLabel && (
                  <button onClick={onClearDrill} title="Clear drill filter" style={{
                    padding: '8px 12px', borderRadius: 10, border: `1px solid ${T.purple}60`,
                    background: `${T.purple}15`, color: T.purple, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <X size={11}/> Clear Filter
                  </button>
              )}
              <IconButton icon={detailVisible ? EyeOff : Eye} onClick={() => setDetailVisible(!detailVisible)} title={detailVisible ? 'Hide details' : 'Show details'}/>
            </div>
          </div>

          {drillLabel && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', background: `${T.purple}18`, borderBottom: `1px solid ${T.purple}40`, fontSize: 11, color: T.purpleLight, fontWeight: 600 }}>
                <Target size={12} color={T.purple}/>
                <span style={{ flex: 1 }}>
              Filtered by: <span style={{ color: T.text }}>{drillLabel}</span>
                  {testCases.total !== undefined && <span className="num" style={{ color: T.textDim, fontWeight: 400 }}> · {pluralize(testCases.total, 'test case')}</span>}
            </span>
              </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!testCases.items?.length ? (
                <EmptyState icon={FileText} title="No test cases" description={drillLabel ? `No test cases found for: ${drillLabel}` : "Select a folder or search to view test cases."}/>
            ) : (
                testCases.items.map((tc, i) => {
                  const isSelected = selectedTestCase?.zephyr_key === tc.zephyr_key;
                  return (
                      <button key={tc.zephyr_key} onClick={() => onSelectTestCase(tc)} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', width: '100%',
                        background: isSelected ? T.blueDim : i % 2 === 0 ? 'transparent' : 'rgba(127,127,127,.04)',
                        borderBottom: `1px solid ${T.borderLight}`,
                        borderLeft: isSelected ? `3px solid ${T.blue}` : '3px solid transparent',
                        textAlign: 'left', cursor: 'pointer', transition: 'all .15s ease'
                      }}>
                        <FileText size={16} color={isSelected ? T.blue : T.textDim} style={{ flexShrink: 0 }}/>
                        <span style={{ fontSize: 13, color: isSelected ? T.blue : T.blueLight, fontFamily: 'ui-monospace, monospace', fontWeight: 600, flexShrink: 0, minWidth: 90 }}>
                    {tc.zephyr_key}
                  </span>
                        <span style={{ fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{tc.name}</span>
                        {tc.is_deleted && <Badge size="xs" color={T.red}>Deleted</Badge>}
                      </button>
                  );
                })
            )}
          </div>

          <div className="num" style={{ padding: 12, borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: T.textMuted, background: T.card }}>
            <span>{(testCases.total || 0) === 0 ? '0' : offset + 1} - {Math.min(offset + 40, testCases.total || 0)} of {(testCases.total || 0).toLocaleString()}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PageBtn onClick={() => onPageChange(0)} disabled={offset === 0}>First</PageBtn>
              <PageBtn onClick={() => onPageChange(Math.max(0, offset - 40))} disabled={offset === 0}><ChevronLeft size={14}/></PageBtn>
              <span style={{ padding: '0 14px', fontSize: 13, color: T.text, fontWeight: 600 }}>{currentPage} / {totalPages || 1}</span>
              <PageBtn onClick={() => onPageChange(offset + 40)} disabled={offset + 40 >= (testCases.total || 0)}><ChevronRight size={14}/></PageBtn>
              <PageBtn onClick={() => onPageChange((totalPages - 1) * 40)} disabled={offset + 40 >= (testCases.total || 0)}>Last</PageBtn>
            </div>
          </div>
        </div>

        {detailVisible && <ResizeHandle onMouseDown={listPanel.handleMouseDown}/>}

        {detailVisible && (
            <div className="pane" style={{ flex: 1, minWidth: isNarrow ? 0 : 350, minHeight: isNarrow ? 320 : 0, overflow: 'hidden', background: T.bgSurface }}>
              {selectedTestCase ? (
                  <TestDetailPanel testCase={selectedTestCase} resolveUser={resolveUser}/>
              ) : (
                  <EmptyState icon={FileText} title="Select a Test Case" description="Click on a test case to view details and history."/>
              )}
            </div>
        )}
      </div>
  );
}

function PageBtn({ children, onClick, disabled }) {
  return (
      <button onClick={onClick} disabled={disabled} style={{
        padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.border}`,
        background: 'transparent', color: disabled ? T.textDim : T.text,
        fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        display: 'flex', alignItems: 'center'
      }}>{children}</button>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    'Approved': { c: T.green, bg: T.greenDim },
    'Draft': { c: T.yellow, bg: T.yellowDim },
    'Deprecated': { c: T.red, bg: T.redDim },
    'In Review': { c: T.blue, bg: T.blueDim },
  }[status] || { c: T.textMuted, bg: 'rgba(127,127,127,.12)' };
  return <Badge size="xs" color={cfg.c} bg={cfg.bg}>{status || 'Draft'}</Badge>;
}

function FolderTree({ node, depth, selected, onSelect, searchTerm }) {
  const [open, setOpen] = useState(depth < 1 || !!searchTerm);
  const hasKids = node.children?.length > 0;
  const isSelected = selected === node.folder_id;
  const count = node.test_case_count || 0;

  useEffect(() => { if (searchTerm) setOpen(true); }, [searchTerm]);

  const highlightText = (text, term) => {
    if (!term || !text) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text;
    return (<>{text.slice(0, idx)}<span style={{ background: T.yellowDim, color: T.yellow, borderRadius: 2, padding: '0 2px' }}>{text.slice(idx, idx + term.length)}</span>{text.slice(idx + term.length)}</>);
  };

  return (
      <div>
        <button onClick={() => { if (hasKids) setOpen(!open); onSelect(node.folder_id); }} style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: `8px 12px 8px ${8 + depth * 18}px`, borderRadius: 8, marginBottom: 2,
          background: isSelected ? T.blueDim : 'transparent',
          border: isSelected ? `1px solid ${T.blue}40` : '1px solid transparent',
          cursor: 'pointer', textAlign: 'left', transition: 'all .15s ease'
        }}>
        <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textDim, borderRadius: 4, background: hasKids ? 'rgba(127,127,127,.08)' : 'transparent' }}>
          {hasKids ? (open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : <span style={{ width: 14 }}/>}
        </span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
          {hasKids ? (open ? <FolderOpen size={16} color={isSelected ? T.blue : T.yellow}/> : <Folder size={16} color={isSelected ? T.blue : T.yellow}/>) : <FileText size={16} color={T.textDim}/>}
        </span>
          <span style={{ flex: 1, fontSize: 13, color: isSelected ? T.blue : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
          {highlightText(node.name, searchTerm)}
        </span>
          <span className="num" style={{
            fontSize: 11, fontWeight: 600, minWidth: 28, textAlign: 'center', padding: '2px 8px', borderRadius: 10,
            background: count > 0 ? (isSelected ? T.blue : 'rgba(127,127,127,.12)') : 'transparent',
            color: count > 0 ? (isSelected ? '#fff' : T.textSecondary) : T.textDim
          }}>
          {count > 0 ? count.toLocaleString() : '0'}
        </span>
        </button>
        {hasKids && open && (
            <div style={{ borderLeft: depth > 0 ? `1px solid ${T.border}` : 'none', marginLeft: depth > 0 ? 20 : 0 }}>
              {node.children.map(c => <FolderTree key={c.folder_id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} searchTerm={searchTerm}/>)}
            </div>
        )}
      </div>
  );
}

function TestDetailPanel({ testCase, resolveUser }) {
  const [tab, setTab] = useState('details');
  const [fullData, setFullData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    let mounted = true;
    setFullData(null);
    setHistory([]);
    apiFetch(`/testcases/${testCase.zephyr_key}`).then(d => mounted && setFullData(d)).catch(() => {});
    setLoadingHistory(true);
    apiFetch(`/logs/${testCase.zephyr_key}/history`)
        .then(d => { if (mounted) { setHistory(Array.isArray(d) ? d : []); setLoadingHistory(false); } })
        .catch(() => { if (mounted) { setHistory([]); setLoadingHistory(false); } });
    return () => { mounted = false; };
  }, [testCase.zephyr_key]);

  const raw = fullData?.raw_snapshot || testCase.raw_snapshot || {};
  const steps = fullData?.steps_json || testCase.steps_json || [];

  const tabs = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'script', label: 'Steps', icon: List },
    { id: 'history', label: 'History', icon: History, count: history.length },
  ];

  return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: 20, borderBottom: `1px solid ${T.border}`, background: T.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.blue, fontFamily: 'ui-monospace, monospace' }}>{testCase.zephyr_key}</span>
            <StatusBadge status={testCase.status}/>
            {testCase.is_deleted && <Badge size="xs" color={T.red} icon={Trash2}>Deleted</Badge>}
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.5, marginBottom: 10 }}>{testCase.name}</h2>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: T.textMuted, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><User size={12} color={T.purple}/> {resolveUser(testCase.owner_name, testCase.owner_account) || 'Unassigned'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Folder size={12} color={T.yellow}/> {testCase.folder_path?.split(' > ').pop() || 'Root'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, background: T.bgAlt }}>
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
                <button key={t.id} onClick={() => setTab(t.id)} aria-current={isActive ? 'page' : undefined} style={{
                  padding: '12px 18px', border: 'none', fontSize: 13, cursor: 'pointer',
                  borderBottom: isActive ? `2px solid ${T.blue}` : '2px solid transparent',
                  background: 'transparent', color: isActive ? T.blue : T.textMuted,
                  fontWeight: isActive ? 600 : 400, display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <Icon size={14}/> {t.label}
                  {t.count !== undefined && <Badge size="xs" color={T.textDim}>{t.count}</Badge>}
                </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {tab === 'details' && (
              <div>
                <Section title="Description"><p style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.7 }}>{raw.name || testCase.name}</p></Section>
                {raw.objective && <Section title="Objective"><p style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.7 }}>{cleanDisplayText(raw.objective)}</p></Section>}
                {raw.precondition && <Section title="Precondition"><p style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.7 }}>{cleanDisplayText(raw.precondition)}</p></Section>}
                <Section title="Details">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <DetailField label="Status" value={testCase.status}/>
                    <DetailField label="Priority" value={testCase.priority || raw.priority?.name}/>
                    <DetailField label="Owner" value={resolveUser(testCase.owner_name, testCase.owner_account) || resolveUser(raw.owner?.displayName, raw.owner?.accountId)}/>
                    <DetailField label="Folder" value={testCase.folder_path}/>
                  </div>
                </Section>
                {raw.labels?.length > 0 && <Section title="Labels"><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{raw.labels.map((l, i) => <Badge key={i} size="sm" color={T.cyan}>{l}</Badge>)}</div></Section>}
                {raw.customFields && Object.keys(raw.customFields).length > 0 && (
                    <Section title="Custom Fields">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        {Object.entries(raw.customFields).map(([k, v]) => <DetailField key={k} label={formatFieldName(k)} value={String(v)}/>)}
                      </div>
                    </Section>
                )}
              </div>
          )}

          {tab === 'script' && (
              <div>
                <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}><List size={16} color={T.purple}/> {pluralize(steps.length, 'Step')}</div>
                {steps.length === 0 ? (
                    <EmptyState icon={List} title="No Steps" description="This test case has no steps defined."/>
                ) : (
                    steps.map((step, i) => (
                        <div key={i} style={{ marginBottom: 14, padding: 16, background: T.card, borderRadius: 12, border: `1px solid ${T.border}` }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                            <span className="num" style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.gradPurple, color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 10 }}>{cleanDisplayText(step.inline?.description || step.description || `Step ${i + 1}`)}</div>
                              {(step.inline?.testData || step.testData) && (
                                  <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 8, padding: 10, background: T.bgSurface, borderRadius: 8, borderLeft: `3px solid ${T.purple}` }}>
                                    <span style={{ color: T.purple, fontWeight: 600 }}>Test Data:</span> {cleanDisplayText(step.inline?.testData || step.testData)}
                                  </div>
                              )}
                              {(step.inline?.expectedResult || step.expectedResult) && (
                                  <div style={{ fontSize: 13, color: T.textMuted, padding: 10, background: T.bgSurface, borderRadius: 8, borderLeft: `3px solid ${T.green}` }}>
                                    <span style={{ color: T.green, fontWeight: 600 }}>Expected:</span> {cleanDisplayText(step.inline?.expectedResult || step.expectedResult)}
                                  </div>
                              )}
                            </div>
                          </div>
                        </div>
                    ))
                )}
              </div>
          )}

          {tab === 'history' && (
              <div>
                {loadingHistory ? (
                    <div style={{ textAlign: 'center', padding: 40, color: T.textDim }}>
                      <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }}/>
                      <p style={{ marginTop: 12, fontSize: 13 }}>Loading history...</p>
                    </div>
                ) : history.length === 0 ? (
                    <EmptyState icon={History} title="No History" description="No changes recorded for this test case."/>
                ) : (
                    <div style={{ position: 'relative', paddingLeft: 24 }}>
                      <div style={{ position: 'absolute', left: 9, top: 12, bottom: 12, width: 2, background: T.border, borderRadius: 1 }}/>
                      {history.map((log, i) => {
                        const cfg = actionConfig(log);
                        const Icon = cfg.icon;
                        const userName = auditActorName(log, resolveUser);
                        return (
                            <div key={log.id || i} style={{ position: 'relative', marginBottom: 16 }}>
                              <div style={{ position: 'absolute', left: -18, top: 6, width: 18, height: 18, borderRadius: 9, background: cfg.bg, border: `2px solid ${cfg.c}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon size={10} color={cfg.c}/>
                              </div>
                              <div style={{ padding: 14, background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, marginLeft: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                  <Badge size="sm" color={cfg.c} bg={cfg.bg} icon={Icon}>{cfg.label}</Badge>
                                  <span className="num" style={{ fontSize: 11, color: T.textDim }}>{fmtDate(log.detected_at, 'detail')}</span>
                                </div>
                                <div style={{ fontSize: 13, color: T.text }}>Modified by: <strong style={{ color: T.purple }}>{userName}</strong></div>
                                {log.changed_fields?.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                                      {log.changed_fields.map(f => {
                                        const beforeVal = log.diff_before?.[f] !== undefined ? String(log.diff_before[f]) : null;
                                        const afterVal = log.diff_after?.[f] !== undefined && f !== 'name' ? String(log.diff_after[f]) : null;
                                        return (
                                          <div key={f} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <Badge size="xs" color={T.purple}>{formatFieldName(f)}</Badge>
                                            {beforeVal || afterVal ? (
                                              <span style={{ color: T.textSecondary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                {beforeVal ? <span style={{ textDecoration: 'line-through', color: T.red, opacity: 0.8 }}>{beforeVal}</span> : null}
                                                {beforeVal && afterVal ? <ArrowRight size={10} color={T.textDim} /> : null}
                                                {afterVal ? <span style={{ color: T.green }}>{afterVal}</span> : null}
                                              </span>
                                            ) : null}
                                          </div>
                                        )
                                      })}
                                    </div>
                                )}
                                {log.folder_before !== log.folder_after && log.action === 'MOVED' && (
                                    <div style={{ marginTop: 10, padding: 10, background: T.bgSurface, borderRadius: 8, fontSize: 12 }}>
                                      <div style={{ color: T.red, marginBottom: 4 }}>From: {log.folder_before}</div>
                                      <div style={{ color: T.green }}>To: {log.folder_after}</div>
                                    </div>
                                )}
                              </div>
                            </div>
                        );
                      })}
                    </div>
                )}
              </div>
          )}
        </div>
      </div>
  );
}

function Section({ title, children }) {
  return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>{title}</div>
        {children}
      </div>
  );
}

function DetailField({ label, value }) {
  return (
      <div style={{ padding: 12, background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.textDim, textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{value || '—'}</div>
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CONFIG VIEW
═══════════════════════════════════════════════════════════════════ */
function ConfigView({ config, actors, folders, onRefresh, stats }) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [pollInterval, setPollInterval] = useSessionState('config_pollInterval', null);
  const [activeTab, setActiveTab] = useState('sync');
  const [showUsers, setShowUsers] = useState(false);
  const intervalRef = useRef(null);
  const syncingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const waitForSyncCompletion = async (triggeredAt = 0) => {
    for (let attempt = 0; attempt < 180; attempt++) {
      if (!mountedRef.current) throw new Error('unmounted');
      const status = await apiFetch('/sync/status');
      const startedAt = status.started_at ? new Date(status.started_at).getTime() : 0;
      if (!status.running && (!triggeredAt || startedAt >= triggeredAt)) return status;
      if (!mountedRef.current) throw new Error('unmounted');
      if (status.running) setSyncStatus({ type: 'info', message: `Sync running since ${fmtDate(status.started_at, 'time')}...` });
      else setSyncStatus({ type: 'info', message: 'Waiting for poller to start...' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('Sync status timed out');
  };

  const handleSync = async (source = 'manual') => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncStatus({ type: 'info', message: `Starting ${source === 'auto' ? 'auto' : 'manual'} sync with Zephyr Scale...` });
    try {
      const triggeredAt = Date.now();
      await apiFetch(`/sync/run?source=${source}`, { method: 'POST' });
      const finalStatus = await waitForSyncCompletion(triggeredAt);
      await onRefresh();
      if (!mountedRef.current) return;
      setSyncStatus({ type: 'success', message: `Sync complete: ${pluralize(finalStatus.total_logged || 0, 'change')} logged.` });
      setTimeout(() => { if (mountedRef.current) setSyncStatus(null); }, 3000);
    } catch (e) {
      if (mountedRef.current && e.message !== 'unmounted') setSyncStatus({ type: 'error', message: `Sync failed: ${e.message}` });
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) setSyncing(false);
    }
  };

  const handleReset = async () => {
    if (resetConfirmText !== 'RESET') return;
    setResetting(true);
    try {
      await fetch(API_BASE + '/reset', { method: 'POST', headers: API_KEY ? { 'X-API-Key': API_KEY } : {} });
      setSyncStatus({ type: 'success', message: 'Database cleared! Ready for fresh sync.' });
      setShowResetConfirm(false);
      setResetConfirmText('');
      setTimeout(onRefresh, 500);
    } catch (e) {
      setSyncStatus({ type: 'error', message: `Reset failed: ${e.message}` });
    }
    setResetting(false);
  };

  const startAutoPoll = (minutes) => {
    setPollInterval(minutes);
    setSyncStatus({ type: 'info', message: `Auto-sync: every ${minutes}m` });
    setTimeout(() => setSyncStatus(null), 2000);
  };

  const stopAutoPoll = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPollInterval(null);
  };

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (pollInterval) intervalRef.current = setInterval(() => handleSync('auto'), pollInterval * 60 * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [pollInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    apiFetch('/sync/status')
        .then(async (status) => {
          if (cancelled || !status.running) return;
          syncingRef.current = true;
          setSyncing(true);
          setSyncStatus({ type: 'info', message: 'Sync is already running. Waiting for completion...' });
          const finalStatus = await waitForSyncCompletion();
          if (cancelled) return;
          await onRefresh();
          setSyncStatus({ type: 'success', message: `Sync complete: ${pluralize(finalStatus.total_logged || 0, 'change')} logged.` });
          setTimeout(() => setSyncStatus(null), 3000);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) { syncingRef.current = false; setSyncing(false); } });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    { id: 'sync', label: 'Sync & Polling', icon: RefreshCw },
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'data', label: 'Data & Users', icon: Database },
  ];

  return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
        <div style={{ padding: '24px 32px', borderBottom: `1px solid ${T.border}`, background: T.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, marginBottom: 4 }}>Settings</h1>
              <p style={{ fontSize: 14, color: T.textMuted }}>Manage sync, configuration, and view system data</p>
            </div>
            <button onClick={onRefresh} style={{
              padding: '10px 20px', borderRadius: 10, border: `1px solid ${T.border}`,
              background: T.card, color: T.text, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8
            }}>
              <RotateCcw size={14}/> Refresh
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} aria-current={isActive ? 'page' : undefined} style={{
                    padding: '10px 20px', borderRadius: 10, border: 'none',
                    background: isActive ? T.gradBlue : 'transparent', color: isActive ? '#fff' : T.textMuted,
                    fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, transition: 'all .2s ease'
                  }}>
                    <Icon size={14}/> {tab.label}
                  </button>
              );
            })}
          </div>
        </div>

        {syncStatus && (
            <div style={{
              margin: '16px 32px 0', padding: 14, borderRadius: 10,
              background: syncStatus.type === 'error' ? T.redDim : syncStatus.type === 'success' ? T.greenDim : T.blueDim,
              border: `1px solid ${syncStatus.type === 'error' ? T.red : syncStatus.type === 'success' ? T.green : T.blue}40`,
              display: 'flex', alignItems: 'center', gap: 10, animation: 'slideIn .2s ease'
            }}>
              {syncStatus.type === 'error' ? <XCircle size={18} color={T.red}/> :
                  syncStatus.type === 'success' ? <CheckCircle2 size={18} color={T.green}/> :
                      <RefreshCw size={18} color={T.blue} style={{ animation: 'spin 1s linear infinite' }}/>}
              <span style={{ fontSize: 13, color: T.text }}>{syncStatus.message}</span>
            </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {activeTab === 'sync' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 20 }}>Quick Actions</h3>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <button onClick={() => handleSync('manual')} disabled={syncing} style={{
                        padding: '16px 36px', borderRadius: 12, border: 'none',
                        background: syncing ? T.bgSurface : T.gradBlue, color: '#fff',
                        fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10,
                        boxShadow: syncing ? 'none' : '0 6px 20px rgba(96,165,250,.35)'
                      }}>
                        <RefreshCw size={18} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}/>
                        {syncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                      {pollInterval ? (
                          <button onClick={stopAutoPoll} style={{
                            padding: '16px 28px', borderRadius: 12, border: 'none', background: T.greenDim, color: T.green,
                            fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8
                          }}>
                            <div style={{ width: 8, height: 8, borderRadius: 4, background: T.green, animation: 'pulse 2s infinite' }}/>
                            Auto: {pollInterval}m — Click to Stop
                          </button>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Auto-Sync Schedule</h3>
                    <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>Automatically sync with Zephyr at regular intervals</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                      {[1, 5, 15, 30, 60].map(min => (
                          <button key={min} onClick={() => startAutoPoll(min)} style={{
                            padding: '14px 0', borderRadius: 10, border: `2px solid ${pollInterval === min ? T.green : T.border}`,
                            background: pollInterval === min ? T.greenDim : T.bgSurface,
                            color: pollInterval === min ? T.green : T.textSecondary, fontSize: 14, fontWeight: 600, textAlign: 'center'
                          }}>
                            {min < 60 ? `${min} min` : '1 hour'}
                          </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.red}30` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.red, marginBottom: 6 }}>Danger Zone</h3>
                    <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>Irreversible actions that affect your data</p>
                    {!showResetConfirm ? (
                        <button onClick={() => setShowResetConfirm(true)} style={{
                          padding: '12px 24px', borderRadius: 10, border: `1px solid ${T.red}40`,
                          background: 'transparent', color: T.red, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8
                        }}>
                          <Trash2 size={16}/> Clear All Data
                        </button>
                    ) : (
                        <div style={{ padding: 20, background: T.redDim, borderRadius: 12 }}>
                          <p style={{ fontSize: 14, color: T.text, marginBottom: 12 }}>
                            <strong>Are you sure?</strong> This deletes all test cases, audit logs, and user data. Type <strong>RESET</strong> to confirm.
                          </p>
                          <input
                              value={resetConfirmText} onChange={e => setResetConfirmText(e.target.value)} placeholder="Type RESET"
                              aria-label="Type RESET to confirm"
                              style={{ width: '100%', maxWidth: 220, padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.red}60`, background: T.bgSurface, color: T.text, fontSize: 13, marginBottom: 16 }}
                          />
                          <div style={{ display: 'flex', gap: 12 }}>
                            <button onClick={handleReset} disabled={resetting || resetConfirmText !== 'RESET'} style={{
                              padding: '12px 20px', borderRadius: 8, border: 'none',
                              background: resetConfirmText === 'RESET' ? T.red : T.bgSurface,
                              color: resetConfirmText === 'RESET' ? '#fff' : T.textDim, fontSize: 13, fontWeight: 600,
                              cursor: resetConfirmText === 'RESET' ? 'pointer' : 'not-allowed'
                            }}>
                              {resetting ? 'Clearing...' : 'Yes, Clear Everything'}
                            </button>
                            <button onClick={() => { setShowResetConfirm(false); setResetConfirmText(''); }} style={{
                              padding: '10px 20px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13
                            }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                    )}
                  </div>
                </div>
            )}

            {activeTab === 'config' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                      <AlertCircle size={18} color={T.yellow}/>
                      <span style={{ fontSize: 13, color: T.textMuted }}>Configuration is loaded from environment variables. Restart the server after making changes.</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <SettingsField label="Project Key" value={config?.project_key} icon={Hash}/>
                      <SettingsField label="Parent Folder ID" value={config?.parent_folder_id} icon={Folder}/>
                      <SettingsField label="Parent Folder Name" value={config?.parent_folder_name || '—'} icon={Folder}/>
                      <SettingsField label="Fetch Test Steps" value={config?.fetch_test_steps ? 'Enabled' : 'Disabled'} icon={List}/>
                    </div>
                  </div>
                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 20 }}>API Configuration</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                      <SettingsField label="Zephyr Scale API URL" value={config?.base_url} icon={ExternalLink} mono/>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <SettingsField label="Page Size" value={config?.api_max_limit} icon={Layers}/>
                        <SettingsField label="Archive Statuses" value={config?.archive_status_names?.join(', ') || 'Archived, Deprecated'} icon={AlertTriangle}/>
                      </div>
                    </div>
                  </div>
                </div>
            )}

            {activeTab === 'data' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                    <MiniStatCard icon={Layers} label="Test Cases" value={stats.total_cases} color={T.blue}/>
                    <MiniStatCard icon={Activity} label="Audit Logs" value={stats.total_logs} color={T.purple}/>
                    <MiniStatCard icon={Folder} label="Folders" value={folders.length} color={T.yellow}/>
                    <MiniStatCard icon={Users} label="Users" value={actors.length} color={T.teal}/>
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Tracked Users</h3>
                        <p style={{ fontSize: 13, color: T.textMuted }}>{pluralize(actors.length, 'user')} have made changes</p>
                      </div>
                      <button onClick={() => setShowUsers(!showUsers)} style={{
                        padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textSecondary, fontSize: 13
                      }}>
                        {showUsers ? 'Hide' : 'Show All'}
                      </button>
                    </div>
                    {showUsers && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxHeight: 300, overflowY: 'auto' }}>
                          {actors.map((a, i) => (
                              <div key={a.account_id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, background: T.bgSurface, border: `1px solid ${T.border}` }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: [T.gradBlue, T.gradPurple, T.gradGreen, T.gradOrange, T.gradPink][i % 5], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>
                                  {(a.display_name || 'U').charAt(0).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 14, color: T.text, fontWeight: 600 }}>{a.display_name || 'Unknown'}</div>
                                  <div style={{ fontSize: 11, color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.account_id}</div>
                                </div>
                              </div>
                          ))}
                        </div>
                    )}
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 20 }}>Folder Structure</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                      <div style={{ padding: 20, background: T.bgSurface, borderRadius: 12, textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 32, fontWeight: 700, color: T.yellow }}>{folders.length}</div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Total Folders</div>
                      </div>
                      <div style={{ padding: 20, background: T.bgSurface, borderRadius: 12, textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 32, fontWeight: 700, color: T.blue }}>
                          {Math.max(...folders.map(f => (f.full_path?.split(' > ').length || 1)), 0)}
                        </div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Max Depth</div>
                      </div>
                      <div style={{ padding: 20, background: T.bgSurface, borderRadius: 12, textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 32, fontWeight: 700, color: T.green }}>{folders.filter(f => !f.parent_id).length}</div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Root Folders</div>
                      </div>
                    </div>
                  </div>
                </div>
            )}
          </div>
        </div>
      </div>
  );
}

function SettingsField({ label, value, icon: Icon, mono }) {
  return (
      <div style={{ padding: 16, background: T.bgSurface, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon size={14} color={T.textDim}/>
          <span style={{ fontSize: 11, color: T.textDim, textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 500, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', wordBreak: 'break-all' }}>
          {value || '—'}
        </div>
      </div>
  );
}

function MiniStatCard({ icon: Icon, label, value, color }) {
  return (
      <div style={{ padding: 20, background: T.card, borderRadius: 14, border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Icon size={18} color={color}/>
          <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>{label}</span>
        </div>
        <div className="num" style={{ fontSize: 28, fontWeight: 700, color: T.text }}>{(value || 0).toLocaleString()}</div>
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOADING SCREEN
═══════════════════════════════════════════════════════════════════ */
function LoadingScreen() {
  return (
      <div style={{ height: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 28 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20, background: T.gradBlue,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 12px 40px rgba(96,165,250,.4)', animation: 'glow 2s ease-in-out infinite'
        }}>
          <History size={36} color="#fff"/>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: [T.blue, T.purple, T.teal][i], animation: `pulse 1.4s ${i * 0.15}s ease-in-out infinite` }}/>
          ))}
        </div>
        <span style={{ fontSize: 16, color: T.textMuted, fontWeight: 500 }}>Loading Zephyr Audit...</span>
      </div>
  );
}