import React, { useState, useCallback, useEffect, createContext, useContext } from 'react';
import { flushSync } from 'react-dom';
import {
  Plus, GitCommit, Move, RefreshCw, AlertTriangle, Trash2
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════
   THEME SYSTEM - Dark & Light Mode Support
   ═══════════════════════════════════════════════════════════════════ */
export const darkTheme = {
  bg: '#0a0e14', bgAlt: '#070a0f', bgSurface: '#12171f', sidebar: '#0d1117',
  card: '#151b23', cardHover: '#1a222c', cardActive: '#1f2937',
  border: '#323c4d', borderLight: '#222b39', borderHover: '#516179',
  text: '#f0f6fc', textSecondary: '#c9d1d9', textMuted: '#8b99a6', textDim: '#677685', textSubtle: '#7a8694',
  blue: '#60a5fa', blueLight: '#93c5fd', blueDark: '#3b82f6', blueDim: 'rgba(96,165,250,.15)',
  green: '#10B981', greenLight: '#86efac', greenDark: '#059669', greenDim: 'rgba(74,222,128,.12)',
  red: '#F43F5E', redLight: '#fca5a5', redDark: '#DC2626', redDim: 'rgba(248,113,113,.12)',
  yellow: '#fbbf24', yellowLight: '#fcd34d', yellowDark: '#f59e0b', yellowDim: 'rgba(251,191,36,.12)',
  purple: '#a78bfa', purpleLight: '#c4b5fd', purpleDark: '#8b5cf6', purpleDim: 'rgba(167,139,250,.12)',
  orange: '#fb923c', orangeLight: '#fdba74', orangeDark: '#f97316', orangeDim: 'rgba(251,146,60,.12)',
  teal: '#2dd4bf', tealDim: 'rgba(45,212,191,.12)',
  cyan: '#22d3ee', pink: '#f472b6', pinkDim: 'rgba(244,114,182,.12)',
  gradBlue: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
  gradGreen: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
  gradPurple: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
  gradOrange: 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)',
  gradPink: 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)',
  diffAdd: '#166534', diffAddBg: 'rgba(74,222,128,.1)',
  diffDel: '#991b1b', diffDelBg: 'rgba(248,113,113,.1)',
};

export const lightTheme = {
  bg: '#f8fafc', bgAlt: '#f1f5f9', bgSurface: '#ffffff', sidebar: '#f8fafc',
  card: '#ffffff', cardHover: '#f8fafc', cardActive: '#f1f5f9',
  border: '#d8e0ea', borderLight: '#eef2f7', borderHover: '#b6c2d2',
  text: '#1e293b', textSecondary: '#475569', textMuted: '#5b6678', textDim: '#94a3b8', textSubtle: '#64748b',
  blue: '#2563eb', blueLight: '#60a5fa', blueDark: '#1d4ed8', blueDim: 'rgba(37,99,235,.1)',
  green: '#16a34a', greenLight: '#4ade80', greenDark: '#15803d', greenDim: 'rgba(22,163,74,.1)',
  red: '#dc2626', redLight: '#f87171', redDark: '#b91c1c', redDim: 'rgba(220,38,38,.1)',
  yellow: '#d97706', yellowLight: '#fbbf24', yellowDark: '#b45309', yellowDim: 'rgba(217,119,6,.1)',
  purple: '#7c3aed', purpleLight: '#a78bfa', purpleDark: '#6d28d9', purpleDim: 'rgba(124,58,237,.1)',
  orange: '#ea580c', orangeLight: '#fb923c', orangeDark: '#c2410c', orangeDim: 'rgba(234,88,12,.1)',
  teal: '#0d9488', tealDim: 'rgba(13,148,136,.1)',
  cyan: '#0891b2', pink: '#db2777', pinkDim: 'rgba(219,39,119,.1)',
  gradBlue: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  gradGreen: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  gradPurple: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  gradOrange: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  gradPink: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
  diffAdd: '#166534', diffAddBg: 'rgba(34,197,94,.15)',
  diffDel: '#991b1b', diffDelBg: 'rgba(239,68,68,.15)',
};

export const ThemeContext = createContext({ theme: darkTheme, isDark: true, toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

let activeTheme = darkTheme;
export const setActiveTheme = (theme) => { activeTheme = theme; };
export const T = new Proxy({}, { get: (_t, prop) => activeTheme[prop] });

export const actInfo = () => ({
  CREATED: { c: T.green, bg: T.greenDim, label: 'Created', icon: Plus, gradient: T.gradGreen, glyph: '+' },
  UPDATED: { c: T.yellow, bg: T.yellowDim, label: 'Updated', icon: GitCommit, gradient: T.gradOrange, glyph: '~' },
  MOVED: { c: T.blue, bg: T.blueDim, label: 'Moved Out', icon: Move, gradient: T.gradBlue, glyph: '>' },
  MOVED_IN: { c: T.teal, bg: T.tealDim, label: 'Moved In', icon: RefreshCw, gradient: T.gradGreen, glyph: '<' },
  ARCHIVED: { c: T.orange, bg: T.orangeDim, label: 'Archived', icon: AlertTriangle, gradient: T.gradOrange, glyph: '!' },
  RESTORED: { c: T.green, bg: T.greenDim, label: 'Restored', icon: RefreshCw, gradient: T.gradGreen, glyph: '<' },
  DELETED: { c: T.red, bg: T.redDim, label: 'Deleted', icon: Trash2, gradient: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)', glyph: 'x' },
});

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
export const API_KEY = import.meta.env.VITE_AUDIT_API_KEY || '';
export const POLLS_PAGE_SIZE = 10;
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export const isLegacyScopeReturn = (log) => log?.action === 'RESTORED' && (log.changed_fields || []).includes('folderPath') && !log.folder_before;
export const isScopeReturn = (log) => log?.action === 'MOVED_IN' || isLegacyScopeReturn(log);
export const displayActionKey = (log) => isScopeReturn(log) ? 'MOVED_IN' : log?.action;
export const actionConfig = (logOrAction) => {
  const key = typeof logOrAction === 'string' ? logOrAction : displayActionKey(logOrAction);
  const map = actInfo();
  return map[key] || map.UPDATED;
};

export function auditApiActionToDisplayPreset(apiAction) {
  if (!apiAction) return null;
  const u = apiAction.trim().toUpperCase();
  if (u === 'CREATED') return 'created';
  if (u === 'UPDATED') return 'updated';
  if (u === 'MOVED' || u === 'MOVED_OUT') return 'moved';
  if (u === 'MOVED_IN' || u === 'RESTORED') return 'moved_in';
  if (u === 'DELETED') return 'deleted';
  if (u === 'ARCHIVED') return 'archived';
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   CUSTOM STATE HOOKS
   ═══════════════════════════════════════════════════════════════════ */
export const usePersistentState = (key, defaultValue, { shared = false } = {}) => {
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

export const useSessionState = (key, defaultValue) => usePersistentState(key, defaultValue, { shared: false });

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const listener = (e) => { setMatches(e.matches); };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/* ═══════════════════════════════════════════════════════════════════
   THEME PROVIDER
   ═══════════════════════════════════════════════════════════════════ */
export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = usePersistentState('theme_isDark', true, { shared: true });
  const theme = isDark ? darkTheme : lightTheme;
  setActiveTheme(theme);
  const toggleTheme = useCallback((e) => {
    const isDarkNext = !isDark;
    
    // Fallback for browsers that don't support View Transitions or prefer reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || prefersReducedMotion) {
      document.documentElement.classList.add('theme-transition');
      setIsDark(isDarkNext);
      setTimeout(() => document.documentElement.classList.remove('theme-transition'), 400);
      return;
    }

    const x = e?.clientX ?? window.innerWidth / 2;
    const y = e?.clientY ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        setIsDark(isDarkNext);
      });
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];

      document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 500,
          easing: 'ease-out',
          pseudoElement: '::view-transition-new(root)',
        }
      );
    });
  }, [isDark, setIsDark]);
  return (
      <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
        {children}
      </ThemeContext.Provider>
  );
}
