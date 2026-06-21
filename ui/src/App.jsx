import React, { useState, useMemo, useCallback, useEffect, Component } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import QAChecklistPage from "./pages/QAChecklistPage";
import Sidebar from "./components/Sidebar";
import ConfigView, { LoadingScreen } from "./components/ConfigView";
import LiveStreamView from "./components/LiveStreamView";
import TestRepositoryView from "./components/TestRepositoryView";

import {
  T,
  useTheme,
  ThemeProvider,
  usePersistentState,
  useSessionState,
  useMediaQuery,
  auditApiActionToDisplayPreset,
  POLLS_PAGE_SIZE,
  STALE_AFTER_MS
} from "./theme";

import {
  apiFetch,
  createUserResolver
} from "./utils";

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL STYLES - Enhanced animations, interactions & accessibility
═══════════════════════════════════════════════════════════════════ */
function buildGS() {
  const t = T;
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

  button:focus-visible,[role="button"]:focus-visible,a:focus-visible,[tabindex]:focus-visible{
    outline:2px solid ${T.blue};outline-offset:2px;border-radius:8px
  }
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

  .sb-nav-btn{display:flex;align-items:center;gap:10px;width:100%;border:none;text-align:left;transition:all .18s ease;cursor:pointer}
  .sb-nav-btn:not(.active):hover{background:${T.bgAlt}!important;color:${T.text}!important}
  `;
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

  useEffect(() => { fetchInitial(); }, []);

  const resolveUser = useMemo(() => createUserResolver(actors), [actors]);

  return { polls, pollTotal, folders, testCases, config, stats, actors, loading, lastSync,
    fetchPolls, fetchTestCases, fetchStats, refetch: fetchInitial, resolveUser,
    statsPeriod, setStatsPeriod };
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
   PANEL ERROR BOUNDARY
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
    setSelectedPoll(null);
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

  useEffect(() => {
    if (nav !== 'stream' || streamDrillLabel || selectedPoll || polls.length === 0) return;
    setSelectedPoll(polls[0]);
  }, [nav, polls, streamDrillLabel, selectedPoll]);

  useEffect(() => {
    const hasRunningPoll = nav === 'stream' && polls.some(poll => poll.status === 'running');
    if (!hasRunningPoll) return undefined;
    const timer = setInterval(() => {
      fetchPolls(filters, { limit: POLLS_PAGE_SIZE, offset: pollOffset });
      fetchStats();
    }, 3000);
    return () => clearInterval(timer);
  }, [nav, polls, filters, pollOffset, fetchPolls, fetchStats]);

  useEffect(() => {
    if (!selectedPoll) return;
    const freshPoll = polls.find(poll => poll.poll_id === selectedPoll.poll_id);
    if (freshPoll && freshPoll !== selectedPoll) setSelectedPoll(freshPoll);
  }, [polls, selectedPoll]);

  const latestPollTs = useMemo(() => (pollOffset === 0 && polls.length ? polls[0].poll_timestamp : null), [pollOffset, polls]);
  const isStale = useMemo(() => (latestPollTs ? (Date.now() - new Date(latestPollTs).getTime()) > STALE_AFTER_MS : false), [latestPollTs]);

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