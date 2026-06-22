import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Folder, FolderOpen, FileText, Search, X, Target, Eye, EyeOff,
  ChevronLeft, ChevronRight, ChevronDown, Info, List, History, Trash2, User, ArrowRight, RefreshCw
} from 'lucide-react';

import { T, useSessionState, actionConfig } from '../theme';
import { apiFetch, pluralize, fmtDate, NEWLINE, TABCH } from '../utils';
import { useResizable, EmptyState, IconButton, ResizeHandle, Badge } from './common';
import './TestRepositoryView.css';

function auditActorName(log, resolveUser) {
  if (!log?.actor_name && !log?.actor_account) return 'Unknown Modifier';
  const resolved = resolveUser(log.actor_name, log.actor_account);
  return resolved === 'Unassigned' ? 'Unknown Modifier' : resolved;
}

function formatFieldName(key) {
  return String(key).replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim();
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

export default function TestRepositoryView({ folders, testCases, selectedFolder, onSelectFolder, selectedTestCase, onSelectTestCase, search, onSearch, offset, onPageChange, resolveUser, drillLabel, onClearDrill, isNarrow }) {
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
      <div className="repo-explorer-row">
        {/* Folders sidebar panel */}
        <div className="repo-pane repo-folders-pane" style={{ width: isNarrow ? '100%' : folderPanel.width, minHeight: isNarrow ? 220 : 0 }}>
          <div className="repo-pane-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Folder size={18} color="#fff"/>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Test Cases</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{totalCases.toLocaleString()} total</div>
              </div>
            </div>
            
            <div className="repo-search-input-wrapper">
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}/>
              <input
                  value={folderSearch} 
                  onChange={e => setFolderSearch(e.target.value)} 
                  placeholder="Search folders..."
                  aria-label="Search folders"
              />
              {folderSearch && (
                  <button onClick={() => setFolderSearch('')} aria-label="Clear folder search" className="repo-search-clear-btn">
                    <X size={12}/>
                  </button>
              )}
            </div>
          </div>
          <div className="repo-tree-container thin-scrollbar">
            <FolderTree node={filteredFolderTree} depth={0} selected={selectedFolder} onSelect={onSelectFolder} searchTerm={folderSearch}/>
          </div>
        </div>

        <ResizeHandle onMouseDown={folderPanel.handleMouseDown}/>

        {/* Test List Panel */}
        <div className="repo-pane repo-list-pane" style={{ width: isNarrow ? '100%' : (detailVisible ? listPanel.width : 'auto'), minHeight: isNarrow ? 280 : 0, flex: !isNarrow && detailVisible ? 'none' : 1 }}>
          <div style={{ padding: 12, borderBottom: `1px solid var(--border)`, background: 'var(--card)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="repo-search-input-wrapper" style={{ flex: 1, maxWidth: 300 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}/>
              <input
                  value={searchInput} 
                  onChange={e => setSearchInput(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search test cases..." 
                  aria-label="Search test cases"
              />
              {searchInput && (
                  <button onClick={() => { setSearchInput(''); onSearch(''); }} aria-label="Clear test case search" className="repo-search-clear-btn">
                    <X size={12}/>
                  </button>
              )}
            </div>
            <button onClick={handleSearch} className="qa-btn-primary" style={{ padding: '8px 16px', fontSize: 13, height: 38 }}>Search</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {drillLabel && (
                  <button onClick={onClearDrill} title="Clear drill filter" style={{
                    padding: '8px 12px', borderRadius: 8, border: `1px solid rgba(167,139,250,.4)`,
                    background: `rgba(167,139,250,.1)`, color: 'var(--purple)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <X size={11}/> Clear Filter
                  </button>
              )}
              <IconButton icon={detailVisible ? EyeOff : Eye} onClick={() => setDetailVisible(!detailVisible)} title={detailVisible ? 'Hide details' : 'Show details'}/>
            </div>
          </div>

          {drillLabel && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: `rgba(167,139,250,.1)`, borderBottom: `1px solid var(--border)`, fontSize: 12, color: 'var(--purple)', fontWeight: 600 }}>
                <Target size={12} color="var(--purple)"/>
                <span style={{ flex: 1 }}>
                  Filtered by: <span style={{ color: 'var(--text-primary)' }}>{drillLabel}</span>
                  {testCases.total !== undefined && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {pluralize(testCases.total, 'test case')}</span>}
                </span>
              </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }} className="thin-scrollbar">
            {!testCases.items?.length ? (
                <EmptyState icon={FileText} title="No test cases" description={drillLabel ? `No test cases found for: ${drillLabel}` : "Select a folder or search to view test cases."}/>
            ) : (
                testCases.items.map((tc, i) => {
                  const isSelected = selectedTestCase?.zephyr_key === tc.zephyr_key;
                  return (
                      <button key={tc.zephyr_key} onClick={() => onSelectTestCase(tc)} className={`test-case-row-card ${isSelected ? 'selected' : ''}`}>
                        <FileText size={16} color={isSelected ? 'var(--blue)' : 'var(--text-dim)'} style={{ flexShrink: 0 }}/>
                        <span className="test-case-row-key">
                          {tc.zephyr_key}
                        </span>
                        <span className="test-case-row-name">{tc.name}</span>
                        {tc.is_deleted && <Badge size="xs" color="var(--red)" bg="var(--redDim)">Deleted</Badge>}
                      </button>
                  );
                })
            )}
          </div>

          <div className="repo-pagination-bar">
            <span>{(testCases.total || 0) === 0 ? '0' : offset + 1} - {Math.min(offset + 40, testCases.total || 0)} of {(testCases.total || 0).toLocaleString()}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => onPageChange(0)} disabled={offset === 0} className="repo-page-btn">First</button>
              <button onClick={() => onPageChange(Math.max(0, offset - 40))} disabled={offset === 0} className="repo-page-btn"><ChevronLeft size={14}/></button>
              <span className="repo-page-indicator">{currentPage} / {totalPages || 1}</span>
              <button onClick={() => onPageChange(offset + 40)} disabled={offset + 40 >= (testCases.total || 0)} className="repo-page-btn"><ChevronRight size={14}/></button>
              <button onClick={() => onPageChange((totalPages - 1) * 40)} disabled={offset + 40 >= (testCases.total || 0)} className="repo-page-btn">Last</button>
            </div>
          </div>
        </div>

        {detailVisible && <ResizeHandle onMouseDown={listPanel.handleMouseDown}/>}

        {detailVisible && (
            <div className="repo-pane repo-detail-pane" style={{ flex: 1, minWidth: isNarrow ? 0 : 350, minHeight: isNarrow ? 320 : 0 }}>
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
        <button onClick={() => { if (hasKids) setOpen(!open); onSelect(node.folder_id); }} className={`folder-tree-row-btn ${isSelected ? 'selected' : ''}`} style={{ paddingLeft: `${8 + depth * 18}px` }}>
          <span className={`folder-tree-chevron ${open ? 'open' : ''}`} style={{ visibility: hasKids ? 'visible' : 'hidden' }}>
            {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
          </span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {hasKids ? (open ? <FolderOpen size={16} color={isSelected ? 'var(--blue)' : 'var(--yellow)'}/> : <Folder size={16} color={isSelected ? 'var(--blue)' : 'var(--yellow)'}/>) : <FileText size={16} color="var(--text-dim)"/>}
          </span>
          <span style={{ flex: 1, fontSize: 13, color: isSelected ? 'var(--blue)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
            {highlightText(node.name, searchTerm)}
          </span>
          {count > 0 && (
            <span className="folder-count-badge">
              {count.toLocaleString()}
            </span>
          )}
        </button>
        {hasKids && open && (
            <div className="folder-tree-children-container" style={{ borderLeft: depth > 0 ? `1px solid var(--border)` : 'none', marginLeft: depth > 0 ? 20 : 0 }}>
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
        <div className="detail-header-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--blue)', fontFamily: 'ui-monospace, monospace' }}>{testCase.zephyr_key}</span>
            <StatusBadge status={testCase.status}/>
            {testCase.is_deleted && <Badge size="xs" color="var(--red)" bg="var(--redDim)">Deleted</Badge>}
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 10, margin: 0 }}>{testCase.name}</h2>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><User size={12} color="var(--purple)"/> {resolveUser(testCase.owner_name, testCase.owner_account) || 'Unassigned'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Folder size={12} color="var(--yellow)"/> {testCase.folder_path?.split(' > ').pop() || 'Root'}</span>
          </div>
        </div>

        <div className="detail-tab-bar">
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`detail-tab-btn ${isActive ? 'active' : ''}`} aria-current={isActive ? 'page' : undefined}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon size={14}/> {t.label}
                    {t.count !== undefined && <span style={{ fontSize: 10, background: 'var(--border)', color: 'var(--text-secondary)', padding: '2px 6px', borderRadius: 10, fontWeight: 600 }}>{t.count}</span>}
                  </span>
                </button>
            );
          })}
        </div>

        <div className="detail-body-container thin-scrollbar">
          {tab === 'details' && (
              <div>
                <Section title="Description"><p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{raw.name || testCase.name}</p></Section>
                {raw.objective && <Section title="Objective"><p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{cleanDisplayText(raw.objective)}</p></Section>}
                {raw.precondition && <Section title="Precondition"><p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{cleanDisplayText(raw.precondition)}</p></Section>}
                <Section title="Details">
                  <div className="detail-fields-grid">
                    <DetailField label="Status" value={testCase.status}/>
                    <DetailField label="Priority" value={testCase.priority || raw.priority?.name}/>
                    <DetailField label="Owner" value={resolveUser(testCase.owner_name, testCase.owner_account) || resolveUser(raw.owner?.displayName, raw.owner?.accountId)}/>
                    <DetailField label="Folder" value={testCase.folder_path}/>
                  </div>
                </Section>
                {raw.labels?.length > 0 && <Section title="Labels"><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{raw.labels.map((l, i) => <Badge key={i} size="sm" color="var(--cyan)" bg="var(--cyanDim)">{l}</Badge>)}</div></Section>}
                {raw.customFields && Object.keys(raw.customFields).length > 0 && (
                    <Section title="Custom Fields">
                      <div className="detail-fields-grid">
                        {Object.entries(raw.customFields).map(([k, v]) => <DetailField key={k} label={formatFieldName(k)} value={String(v)}/>)}
                      </div>
                    </Section>
                )}
              </div>
          )}

          {tab === 'script' && (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}><List size={16} color="var(--purple)"/> {pluralize(steps.length, 'Step')}</div>
                {steps.length === 0 ? (
                    <EmptyState icon={List} title="No Steps" description="This test case has no steps defined."/>
                ) : (
                    steps.map((step, i) => (
                        <div key={i} style={{ marginBottom: 14, padding: 16, background: 'var(--card)', borderRadius: 12, border: `1px solid var(--border)` }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                            <span className="num" style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gradPurple)', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>{cleanDisplayText(step.inline?.description || step.description || `Step ${i + 1}`)}</div>
                              {(step.inline?.testData || step.testData) && (
                                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, padding: 10, background: 'var(--bg-alt)', borderRadius: 8, borderLeft: `3px solid var(--purple)` }}>
                                    <span style={{ color: 'var(--purple)', fontWeight: 600 }}>Test Data:</span> {cleanDisplayText(step.inline?.testData || step.testData)}
                                  </div>
                              )}
                              {(step.inline?.expectedResult || step.expectedResult) && (
                                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 10, background: 'var(--bg-alt)', borderRadius: 8, borderLeft: `3px solid var(--green)` }}>
                                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>Expected:</span> {cleanDisplayText(step.inline?.expectedResult || step.expectedResult)}
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
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                      <RefreshCw size={24} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading history...</p>
                    </div>
                ) : history.length === 0 ? (
                    <EmptyState icon={History} title="No History" description="No changes recorded for this test case."/>
                ) : (
                    <div className="history-timeline-root">
                      <div className="history-timeline-line"/>
                      {history.map((log, i) => {
                        const cfg = actionConfig(log);
                        const Icon = cfg.icon;
                        const userName = auditActorName(log, resolveUser);
                        return (
                            <div key={log.id || i} className="history-timeline-item">
                              <div className="history-icon-circle" style={{ backgroundColor: cfg.bg, borderColor: cfg.c }}>
                                <Icon size={10} color={cfg.c}/>
                              </div>
                              <div className="history-log-card">
                                <div className="history-card-header">
                                  <Badge size="sm" color={cfg.c} bg={cfg.bg} icon={Icon}>{cfg.label}</Badge>
                                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtDate(log.detected_at, 'detail')}</span>
                                </div>
                                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>Modified by: <strong style={{ color: 'var(--purple)' }}>{userName}</strong></div>
                                {log.changed_fields?.length > 0 && (
                                    <div className="history-diff-list">
                                      {log.changed_fields.map(f => {
                                        const beforeVal = log.diff_before?.[f] !== undefined ? String(log.diff_before[f]) : null;
                                        const afterVal = log.diff_after?.[f] !== undefined && f !== 'name' ? String(log.diff_after[f]) : null;
                                        return (
                                          <div key={f} className="history-diff-row">
                                            <Badge size="xs" color="var(--purple)">{formatFieldName(f)}</Badge>
                                            {beforeVal || afterVal ? (
                                              <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                {beforeVal ? <span style={{ textDecoration: 'line-through', color: 'var(--red)', opacity: 0.8 }}>{beforeVal}</span> : null}
                                                {beforeVal && afterVal ? <ArrowRight size={10} color="var(--text-dim)" /> : null}
                                                {afterVal ? <span style={{ color: 'var(--green)' }}>{afterVal}</span> : null}
                                              </span>
                                            ) : null}
                                          </div>
                                        )
                                      })}
                                    </div>
                                )}
                                {log.folder_before !== log.folder_after && log.action === 'MOVED' && (
                                    <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-alt)', borderRadius: 8, fontSize: 12 }}>
                                      <div style={{ color: 'var(--red)', marginBottom: 4 }}>From: {log.folder_before}</div>
                                      <div style={{ color: 'var(--green)' }}>To: {log.folder_after}</div>
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
      <div className="detail-section-wrapper">
        <div className="detail-section-title">{title}</div>
        {children}
      </div>
  );
}

function DetailField({ label, value }) {
  return (
      <div className="detail-field-card">
        <div className="detail-field-label">{label}</div>
        <div className="detail-field-value">{value || '—'}</div>
      </div>
  );
}
