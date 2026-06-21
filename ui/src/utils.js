const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const API_KEY = import.meta.env.VITE_AUDIT_API_KEY || '';

export const apiFetch = async (path, options = {}) => {
  const headers = { ...options.headers, 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ detail: 'Request failed with status ' + res.status }));
    throw new Error(errorBody.detail || `API error ${res.status}`);
  }
  return res.json();
};

export const pluralize = (n, singular, plural) =>
    `${Number(n || 0).toLocaleString()} ${Number(n) === 1 ? singular : (plural || `${singular}s`)}`;

export const NEWLINE = String.fromCharCode(10);
export const TABCH = String.fromCharCode(9);

export const fmtDate = (value, mode = 'card') => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  if (mode === 'detail') return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (mode === 'time') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (mode === 'short') return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const relativeTime = (value) => {
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

export function describeDelta(deltaPct) {
  if (typeof deltaPct !== 'number' || Number.isNaN(deltaPct)) {
    return { label: 'no prior data', tone: 'neutral', kind: 'none' };
  }
  if (deltaPct === 0) return { label: 'no change vs prior', tone: 'neutral', kind: 'flat' };
  if (deltaPct === 100) return { label: 'new this period', tone: 'up', kind: 'new' };
  if (deltaPct > 0) return { label: `+${deltaPct}% vs prior`, tone: 'up', kind: 'up' };
  return { label: `${deltaPct}% vs prior`, tone: 'down', kind: 'down' };
}

export const isUnknownActor = (name) =>
    !name || /^(unknown|unassigned|unknown user|unknown modifier|system|u)$/i.test(String(name).trim());

export const isAbortError = (e) => e?.name === 'AbortError';

export function createUserResolver(actors) {
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



