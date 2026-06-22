import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search, X, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft,
  Target, Activity, GitBranch, User, Folder, Calendar, Clock,
  GitCommit, FolderOpen, Move, ArrowRight, ChevronRight, ListChecks,
  FileText, Sparkles, AlertTriangle, RefreshCw, Trash2, CheckCircle2
} from 'lucide-react';

import { T, useSessionState, actionConfig, isScopeReturn, POLLS_PAGE_SIZE, displayActionKey } from '../theme';
import { apiFetch, pluralize, fmtDate, relativeTime, isAbortError, NEWLINE, TABCH } from '../utils';
import { useResizable, EmptyState, SkeletonCard, ResizeHandle, Badge } from './common';

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
  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await apiFetch('/sync/run?source=manual', { method: 'POST' });
      await new Promise(r => setTimeout(r, 2000));
      await onRefresh();
    } catch (e) {
      console.error('Sync error:', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px',
        background: T.yellowDim, borderBottom: `1px solid ${T.yellow}40`,
      }}>
        <AlertTriangle size={14} color={T.yellow}/>
        <span style={{ flex: 1, fontSize: 11, color: T.text, fontWeight: 500 }}>
        Data may be stale — last sync {relativeTime(latestPollTs)}.
      </span>
        <button onClick={handleSync} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7,
          border: `1px solid ${T.yellow}60`, background: 'transparent', color: T.yellowDark || T.yellow,
          fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: syncing ? 0.7 : 1
        }}>
          <RefreshCw size={11} style={syncing ? { animation: 'spin 1s linear infinite' } : {}}/> {syncing ? 'Syncing...' : 'Sync now'}
        </button>
      </div>
  );
}

export default function LiveStreamView({ polls, actors, folders, filters, onFilterChange, onApplyFilters, onClearFilters, selectedPoll, onSelectPoll, selectedLog, onSelectLog, pollOffset, pollTotal, onPollPageChange, resolveUser, pollPresetDisplayAction, drillLabel, isStale, latestPollTs, onRefresh, isNarrow }) {
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
                <PollChangesPanel poll={selectedPoll} selectedLog={selectedLog} onSelectLog={onSelectLog} resolveUser={resolveUser} presetPollActionDisplay={pollPresetDisplayAction}/>
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
  const [expanded, setExpanded] = useState(true);
  const isRunning = poll.status === 'running';
  const isFailed = poll.status === 'failed';
  const changeCount = poll.total_changes || 0;
  const hasChanges = changeCount > 0;
  const isEmpty = !isRunning && !hasChanges;

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

function MergedChangesPanel({ drillLabel, filters, resolveUser, onSelectLog, selectedLog }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const PAGE = 40;
  const abortRef = useRef(null);

  const fetchEntries = useCallback(async (off = 0) => {
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
                const actor = typeof resolveUser === 'function' ? resolveUser(log.actor_name, log.actor_account) : log.actor_name;
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
  const [isOpen, setIsOpen] = useState(true);
  
  const changes = useMemo(() => data.changes || [], [data.changes]);
  const pathParts = folderPath.split(' > ');
  const folderName = pathParts.pop();
  const parentPath = pathParts.length > 0 ? pathParts.join(' > ') : null;

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
  const resolved = typeof resolveUser === 'function' ? resolveUser(log.actor_name, log.actor_account) : log.actor_name;
  return resolved === 'Unassigned' || !resolved ? (log.actor_name || 'Unknown Modifier') : resolved;
}

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
            <Badge size="sm" color={T.blue} bg={T.blueDim} icon={ListChecks}>Structured Diff</Badge>
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

  const beforeScript = normalizeScriptRows(before.testSteps || before.steps || before.script || before.testScript, resolveUser);
  const afterScript = normalizeScriptRows(after.testSteps || after.steps || after.script || after.testScript, resolveUser);
  const maxRows = Math.max(beforeScript.length, afterScript.length);
  for (let i = 0; i < maxRows; i++) push('steps', `step-${i}`, `Step ${i + 1}`, beforeScript[i], afterScript[i], 'step');

  return items;
}

function formatFieldName(key) {
  return String(key).replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim();
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
  if (typeof resolveUser !== 'function') return String(value?.displayName || value?.name || value || '');
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

function normalizeScriptRows(script, resolveUser) {
  if (!script) return [];
  const rows = Array.isArray(script) ? script : (script.steps || script.testSteps || script.inline?.steps || script.plainText || script.text || script);
  if (typeof rows === 'string') return [rows];
  if (!Array.isArray(rows)) return [readableValue(rows, resolveUser)].filter(Boolean);
  return rows.map((step) => {
    if (typeof step === 'string') return step;
    const inline = step.inline || step;
    const fields = [
      ['Description', inline.description || inline.action],
      ['Test Data', inline.testData || inline.data],
      ['Expected Result', inline.expectedResult || inline.expected || inline.result],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');
    return fields.length ? fields.map(([k, v]) => `${k}: ${readableValue(v, resolveUser)}`).join(NEWLINE) : readableValue(step, resolveUser);
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
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer'
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

function computeWordDiff(oldText, newText) {
  if (!oldText && !newText) return { old: [], new: [] };
  if (!oldText) return { old: [], new: [{ text: newText, type: 'add' }] };
  if (!newText) return { old: [{ text: oldText, type: 'del' }], new: [] };

  const oldWords = String(oldText).split(/(\s+)/);
  const newWords = String(newText).split(/(\s+)/);
  const m = oldWords.length, n = newWords.length;

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
