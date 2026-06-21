import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Folder, FolderOpen, FileText, Search, X, Target, Eye, EyeOff,
  ChevronLeft, ChevronRight, ChevronDown, Info, List, History, Trash2, User, ArrowRight
} from 'lucide-react';

import { T, useSessionState, actionConfig } from '../theme';
import { apiFetch, pluralize, fmtDate, NEWLINE, TABCH } from '../utils';
import { useResizable, EmptyState, IconButton, ResizeHandle, Badge } from './common';

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
