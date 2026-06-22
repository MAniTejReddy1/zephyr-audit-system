import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Calendar, ListChecks, FileText, Search, X, ChevronDown, ChevronRight, ArrowRight, CheckSquare, Square, Folder, AlertTriangle, ChevronUp, AlertCircle, DownloadCloud, Plus, RefreshCw, MinusCircle, User, Upload, Tag, Layers, GitBranch, Activity, Settings, Edit, Copy, Trash2 } from 'lucide-react';
import Badge from '../ui/Badge';

import JiraStatus from './JiraStatus';
import FolderSelect from './FolderSelect';
import { STATUS_ICONS, STATUS_COLORS, STATUS_LABELS } from '../../constants.jsx';
import RightDetailsDrawer from './RightDetailsDrawer.jsx';
import './MainContent.css';

const normalizeVerName = (v) => {
  if (!v) return 'v1.0.0';
  let cleaned = v.trim();
  cleaned = cleaned.replace(/^v\.+/i, 'v');
  if (cleaned.startsWith('V')) {
    cleaned = 'v' + cleaned.slice(1);
  }
  return cleaned;
};

const statusOrder = ['pass', 'pass_flaky', 'fail', 'blocked', 'pending', 'skip', 'na', 'hold'];

const getStatusTone = (pct) => {
  if (pct < 40) {
    return {
      bg: 'rgba(244, 63, 94, 0.1)',
      border: '1px solid var(--danger)',
      text: 'var(--danger)',
      color: '#F43F5E'
    };
  } else if (pct <= 75) {
    return {
      bg: 'rgba(251, 191, 36, 0.1)',
      border: 'var(--warning)',
      text: 'var(--warning)',
      color: '#fbbf24'
    };
  } else {
    return {
      bg: 'rgba(16, 185, 129, 0.1)',
      border: 'var(--success)',
      text: 'var(--success)',
      color: '#10B981'
    };
  }
};

const getCyclePlatformStats = (cycle) => {
  const platformMap = {};
  const items = cycle.items || [];
  items.forEach(item => {
    const platform = item.platform || 'General';
    const status = item.status || 'pending';
    if (!platformMap[platform]) {
      platformMap[platform] = { platform, total: 0, pass: 0, fail: 0, blocked: 0, pending: 0 };
    }
    platformMap[platform].total++;
    if (status === 'pending') {
      platformMap[platform].pending++;
    } else if (status === 'pass' || status === 'pass_flaky') {
      platformMap[platform].pass++;
    } else if (status === 'fail') {
      platformMap[platform].fail++;
    } else if (status === 'blocked') {
      platformMap[platform].blocked++;
    }
  });
  return Object.values(platformMap).map(p => {
    const executed = p.total - p.pending;
    const passPct = p.total === 0 ? 0 : Math.round((p.pass / p.total) * 100);
    return { ...p, passPct };
  });
};

const renderRadialGauge = (pct, centerElement = null, size = 80, strokeWidth = 6, strokeColor = 'var(--brand-accent)') => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  return (
    <div className="qa-radial-gauge-container" style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg className="qa-radial-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle 
          className="qa-radial-bg-circle" 
          cx={size / 2} 
          cy={size / 2} 
          r={radius} 
          stroke="var(--border-light)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle 
          className="qa-radial-indicator-circle" 
          cx={size / 2} 
          cy={size / 2} 
          r={radius} 
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {centerElement && (
        <div className="qa-radial-center-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute' }}>
          {centerElement}
        </div>
      )}
    </div>
  );
};

const MainContent = ({
  activeCycle,
  pctPass,
  setIsReportOpen,
  searchQ,
  setSearchQ,
  activeFilter,
  setActiveFilter,
  setSelectedItems,
  stats,
  selectedItems,
  setBulkDropOpen,
  bulkDropOpen,
  setDropK,
  dropK,
  updateBulkItems,
  toggleSelectAll,
  filteredItems,
  toggleSelect,
  updateItem,
  setIsImportModalOpen,
  itemToFlashId,
  totalBlockers,
  dueTodayCount,
  flakyTestCount,
  activeModuleFilter,
  setActiveModuleFilter,
  availableTesters,
  activeTagFilter,
  setActiveTagFilter,
  activeSelection,
  setActiveSelection,
  cycles,
  onEditCycleClick,
  onCloneCycleClick,
  onAddCasesClick,
  onDeleteCycleClick,
  onRemoveSelectedItems,
  isAdmin
}) => {
  const isEditable = !activeCycle?.is_locked || isAdmin;
  const [progressWidths, setProgressWidths] = useState({});
  const [selectedItemForDrawer, setSelectedItemForDrawer] = useState(null);
  const [drawerItem, setDrawerItem] = useState(null);
  const [isDrawerTransitionOpen, setIsDrawerTransitionOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [assignDropK, setAssignDropK] = useState(null); // State for individual assignment dropdown
  const [platformDropK, setPlatformDropK] = useState(null); // State for individual platform dropdown
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false); // State for header actions dropdown
  const mainContainerRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;
  const [localSearch, setLocalSearch] = useState(searchQ);

  // Reset currentPage when cycle, search, or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeCycle?.id, searchQ, activeFilter, activeModuleFilter, activeTagFilter]);

  // Sync localSearch state with searchQ prop if searchQ is cleared/updated externally
  useEffect(() => {
    setLocalSearch(searchQ);
  }, [searchQ]);

  // Debounce searchQ updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== searchQ) {
        setSearchQ(localSearch);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [localSearch, searchQ, setSearchQ]);

  const cyclePlatformsList = useMemo(() => {
    if (!activeCycle || !activeCycle.items) return [];
    const unique = new Set(activeCycle.items.map(item => item.platform?.trim()).filter(Boolean));
    return Array.from(unique).sort();
  }, [activeCycle]);

  const openDetailsDrawer = useCallback((item) => {
    setSelectedItemForDrawer(item);
    setDrawerItem(item);
    setTimeout(() => {
      setIsDrawerTransitionOpen(true);
    }, 10);
  }, []);

  const closeDetailsDrawer = useCallback(() => {
    setSelectedItemForDrawer(null);
    setIsDrawerTransitionOpen(false);
    setTimeout(() => {
      setDrawerItem(null);
    }, 300);
  }, []);

  const closeDropdowns = useCallback(() => {
    setDropK(null);
    setBulkDropOpen(false);
    setAssignDropK(null);
    setPlatformDropK(null);
    setActionsMenuOpen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeDropdowns();
    };
    document.addEventListener('click', closeDropdowns);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', closeDropdowns);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDropdowns]);

  const handleBulkExport = useCallback(() => {
    if (selectedItems.size === 0) return;

    const itemsToExport = filteredItems.filter(item => selectedItems.has(item.id));

    // Define CSV headers
    const headers = [
      "ID",
      "Test Case Key",
      "Test Case Name",
      "Module",
      "Folder Path",
      "Platform",
      "Status",
      "Assigned To",
      "Bug ID",
      "Notes",
      "Priority"
    ];

    // Map items to CSV rows
    const csvRows = itemsToExport.map(item => {
      return [
        item.id,
        `"${item.test_case?.zephyr_key || ''}"`,
        `"${item.test_case?.name || ''}"`,
        `"${item.test_case?.module || ''}"`,
        `"${item.test_case?.folder_path || ''}"`,
        `"${item.platform || ''}"`,
        `"${STATUS_LABELS[item.status] || item.status}"`,
        `"${item.assigned_to || ''}"`,
        `"${item.bug_id || ''}"`,
        `"${item.notes ? item.notes.replace(/"/g, '""') : ''}"`, // Escape double quotes in notes
        `"${item.test_case?.priority || ''}"`
      ].join(',');
    });

    // Combine headers and rows
    const csvContent = [headers.join(','), ...csvRows].join('\n');

    // Create a Blob and download it
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) { // Feature detection for download attribute
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `cycle_${activeCycle?.name || 'export'}_selected_items.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      alert('Your browser does not support downloading files directly. Please copy the data manually.');
    }
    setSelectedItems(new Set()); // Clear selection after export
    setBulkDropOpen(false);
  }, [selectedItems, filteredItems, activeCycle, STATUS_LABELS]);



  const availableModules = useMemo(() => {
    if (!activeCycle || !activeCycle.items) return [];
    const unique = new Set(activeCycle.items.map(item => item.module?.trim()).filter(Boolean));
    return ['all', ...Array.from(unique).sort()];
  }, [activeCycle]);

  const targetCycles = useMemo(() => {
    if (!cycles || !activeSelection) return [];
    
    const getParsedParts = (c) => {
      let rc = c.release_cycle;
      let ver = c.version;
      let squad = c.squad;
      
      if (!rc || !ver || !squad) {
        const parts = c.name.split('/');
        if (parts.length >= 3) {
          rc = rc || parts[0].trim();
          ver = ver || parts[1].trim();
          squad = squad || parts[2].trim();
        } else {
          rc = rc || c.name;
          ver = ver || "v1.0.0";
          squad = squad || "Core";
        }
      }
      return { rc, ver: normalizeVerName(ver), squad };
    };

    if (activeSelection.type === 'release') {
      return cycles.filter(c => {
        const parts = getParsedParts(c);
        return parts.rc === activeSelection.name;
      });
    } else if (activeSelection.type === 'version') {
      return cycles.filter(c => {
        const parts = getParsedParts(c);
        return parts.rc === activeSelection.rcName && parts.ver === activeSelection.verName;
      });
    }
    return [];
  }, [cycles, activeSelection]);

  const getStats = useCallback((cycle) => {
    const s = { pass: 0, fail: 0, hold: 0, blocked: 0, skip: 0, na: 0, pending: 0, pass_flaky: 0, total: 0 };
    if (!cycle || !cycle.items) return s;
    cycle.items.forEach(item => {
      s[item.status] = (s[item.status] || 0) + 1;
      s.total++;
    });
    return s;
  }, []);

  const dashboardStats = useMemo(() => {
    const s = { pass: 0, pass_flaky: 0, fail: 0, blocked: 0, pending: 0, skip: 0, na: 0, hold: 0, total: 0 };
    let totalSquads = targetCycles.length;
    let completedSquads = 0;
    
    // Group by version
    const versionMap = {};

    targetCycles.forEach(c => {
      const items = c.items || [];
      let squadTotal = items.length;
      let squadDone = items.filter(i => i.status !== 'pending').length;
      let squadPct = squadTotal === 0 ? 0 : Math.round((squadDone / squadTotal) * 100);
      if (squadPct === 100) {
        completedSquads++;
      }
      
      items.forEach(item => {
        const status = item.status || 'pending';
        s[status] = (s[status] || 0) + 1;
        s.total++;
      });

      // Version grouping
      const ver = c.version || 'v1.0.0';
      const cleanVer = normalizeVerName(ver);
      if (!versionMap[cleanVer]) {
        versionMap[cleanVer] = { verName: cleanVer, squads: [], total: 0, done: 0, pass: 0, fail: 0, blocked: 0 };
      }
      const v = versionMap[cleanVer];
      v.squads.push(c);
      
      const cStats = getStats(c);
      v.total += cStats.total;
      v.done += (cStats.total - cStats.pending);
      v.pass += (cStats.pass + cStats.pass_flaky);
      v.fail += cStats.fail;
      v.blocked += cStats.blocked;
    });

    const versionsList = Object.values(versionMap).map(v => {
      const progress = v.total === 0 ? 0 : Math.round((v.done / v.total) * 100);
      const passRate = v.total === 0 ? 0 : Math.round((v.pass / v.total) * 100);
      const completedSquadsVal = v.squads.filter(s => {
        const sStats = getStats(s);
        const sProgress = sStats.total === 0 ? 0 : Math.round(((sStats.total - sStats.pending) / sStats.total) * 100);
        return sProgress === 100;
      }).length;
      return {
        ...v,
        progress,
        passRate,
        completedSquads: completedSquadsVal,
        totalSquads: v.squads.length
      };
    });

    const pctPass = s.total === 0 ? 0 : Math.round((s.pass / s.total) * 100);
    const pctExecuted = s.total === 0 ? 0 : Math.round(((s.total - s.pending) / s.total) * 100);
    
    // Get all failures/blockers
    const issues = [];
    targetCycles.forEach(c => {
      const items = c.items || [];
      items.forEach(item => {
        if (item.status === 'fail' || item.status === 'blocked') {
          issues.push({ ...item, squadName: c.squad || c.name.split('/').pop().trim() });
        }
      });
    });

    // Get platform quality breakdown
    const platformMap = {};
    targetCycles.forEach(c => {
      const items = c.items || [];
      items.forEach(item => {
        const platform = item.platform || 'General';
        const status = item.status || 'pending';
        if (!platformMap[platform]) {
          platformMap[platform] = { platform, total: 0, pass: 0, fail: 0, blocked: 0, other: 0, pending: 0 };
        }
        platformMap[platform].total++;
        if (status === 'pending') {
          platformMap[platform].pending++;
        } else if (status === 'pass' || status === 'pass_flaky') {
          platformMap[platform].pass++;
        } else if (status === 'fail') {
          platformMap[platform].fail++;
        } else if (status === 'blocked') {
          platformMap[platform].blocked++;
        } else {
          platformMap[platform].other++;
        }
      });
    });

    const platforms = Object.values(platformMap).map(g => {
      const executed = g.total - g.pending;
      const completionPct = g.total === 0 ? 0 : Math.round((executed / g.total) * 100);
      const passPct = g.total === 0 ? 0 : Math.round((g.pass / g.total) * 100);
      return { ...g, completionPct, passPct };
    });

    return {
      stats: s,
      pctPass,
      pctExecuted,
      totalSquads,
      completedSquads,
      issues,
      platforms,
      versionsList
    };
  }, [targetCycles, getStats]);

  useEffect(() => {
    if (activeCycle && stats.total > 0) {
      const newWidths = {};
      const statuses = ['pass', 'pass_flaky', 'fail', 'blocked', 'pending', 'skip', 'na', 'hold'];
      statuses.forEach(status => {
        newWidths[status] = (stats[status] / stats.total) * 100;
      });
      const timer = setTimeout(() => {
        setProgressWidths(newWidths);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setProgressWidths({});
    }
  }, [activeCycle, stats]);

  const groupedItems = useMemo(() => {
    const groups = new Map();
    filteredItems.forEach(item => {
      const module = item.module?.trim() || "Uncategorized";
      if (!groups.has(module)) {
        groups.set(module, []);
      }
      groups.get(module).push(item);
    });
    
    // Sort items within each group: pending first, then stable ID sort
    groups.forEach((items) => {
      items.sort((a, b) => {
        const aPending = a.status === 'pending';
        const bPending = b.status === 'pending';
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        return a.id - b.id;
      });
    });

    // Sort groups alphabetically
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredItems]);

  const tableRows = useMemo(() => {
    const rows = [];
    groupedItems.forEach(([moduleName, itemsInGroup]) => {
      rows.push({ type: 'header', moduleName, itemsInGroup });
      const isCollapsed = collapsedGroups.has(moduleName);
      if (!isCollapsed) {
        itemsInGroup.forEach(item => {
          rows.push({ type: 'item', item, moduleName });
        });
      }
    });
    return rows;
  }, [groupedItems, collapsedGroups]);

  const totalPages = Math.ceil(tableRows.length / itemsPerPage);

  useEffect(() => {
    if (mainContainerRef.current) {
      mainContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  const visibleRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return tableRows.slice(start, start + itemsPerPage);
  }, [tableRows, currentPage, itemsPerPage]);


  const toggleGroupExpand = useCallback((testCaseName) => {
    setCollapsedGroups(prev => {
      const newCollapsed = new Set(prev);
      if (newCollapsed.has(testCaseName)) {
        newCollapsed.delete(testCaseName);
      } else {
        newCollapsed.add(testCaseName);
      }
      return newCollapsed;
    });
  }, []);


  if (activeSelection && (activeSelection.type === 'release' || activeSelection.type === 'version')) {
    const { stats: s, pctPass: dashPctPass, pctExecuted, totalSquads, completedSquads, issues, platforms, versionsList } = dashboardStats;
    const tone = getStatusTone(dashPctPass);
    
    const isRelease = activeSelection.type === 'release';
    
    // For Release: we show versions completed. For Version: we show squads completed.
    const totalItems = isRelease ? versionsList.length : totalSquads;
    const completedItems = isRelease 
      ? versionsList.filter(v => v.progress === 100).length 
      : completedSquads;
    
    const overallCompletion = totalSquads === 0 ? 0 : Math.round((completedSquads / totalSquads) * 100);
    const totalIssues = s.fail + s.blocked;
    
    // Sort squads in alphabetical order or by completion/name
    const sortedSquads = [...targetCycles].sort((a, b) => (a.squad || a.name).localeCompare(b.squad || b.name));

    return (
      <div className="qa-main thin-scrollbar" style={{ overflowY: 'auto', padding: '32px', height: '100%' }}>
        {/* Breadcrumbs and Title */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            <span>Release Portal</span>
            <span>/</span>
            {activeSelection.type === 'version' ? (
              <>
                <span 
                  onClick={() => setActiveSelection({ type: 'release', name: activeSelection.rcName })} 
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {activeSelection.rcName}
                </span>
                <span>/</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{activeSelection.verName}</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{activeSelection.name}</span>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h1 style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
                {activeSelection.type === 'version' ? activeSelection.verName : activeSelection.name}
              </h1>
              <span className={`qa-cycle-status-badge`} style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: overallCompletion === 100 ? 'var(--success-dim)' : 'var(--brand-accent-dim)', color: overallCompletion === 100 ? 'var(--success)' : 'var(--brand-accent)', border: overallCompletion === 100 ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(96,165,250,0.2)' }}>
                {overallCompletion === 100 ? 'Signed Off' : 'Active'}
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setIsReportOpen(true)} className="qa-btn-secondary" style={{ padding: '8px 16px', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                <FileText size={15}/> View Report
              </button>
            </div>
          </div>
        </div>

        {/* Release Timeline Flow (Moved to top for macro view) */}
        {isRelease && versionsList.length > 0 && (
          <div style={{ backgroundColor: 'var(--brand-accent-dim)', border: '1px solid rgba(96, 165, 250, 0.2)', borderRadius: '16px', padding: '24px', marginBottom: '32px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--brand-accent)', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={18} />
              <span>Release Sequence Pipeline</span>
            </div>
            <div className="qa-pipeline-container" style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: '12px' }}>
              {versionsList.map((ver, idx) => {
                const isVerCompleted = ver.progress === 100;
                
                let dotColor = 'var(--border)';
                if (isVerCompleted) {
                  dotColor = 'var(--success)';
                } else if (ver.progress > 0) {
                  dotColor = 'var(--brand-accent)';
                }
                
                return (
                  <React.Fragment key={ver.verName}>
                    {idx > 0 && (
                      <div 
                        className={`qa-pipeline-connector`} 
                        style={{ 
                          height: '3px', 
                          minWidth: '80px', 
                          flexGrow: 1, 
                          backgroundColor: isVerCompleted ? 'var(--success)' : 'rgba(96, 165, 250, 0.3)' 
                        }} 
                      />
                    )}
                    <div 
                      className={`qa-pipeline-node ${isVerCompleted ? 'completed' : ''}`}
                      onClick={() => setActiveSelection({ type: 'version', rcName: activeSelection.name, verName: ver.verName })}
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        gap: '10px', 
                        minWidth: '150px', 
                        cursor: 'pointer', 
                        padding: '16px 12px', 
                        borderRadius: '12px', 
                        transition: 'all 0.2s ease',
                        border: '1px solid rgba(255,255,255,0.05)',
                        backgroundColor: 'var(--card)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                      }}
                    >
                      <div 
                        className="qa-pipeline-dot" 
                        style={{ 
                          width: '16px', 
                          height: '16px', 
                          borderRadius: '50%', 
                          backgroundColor: dotColor, 
                          border: '3px solid var(--card)',
                          boxShadow: ver.progress > 0 && !isVerCompleted ? '0 0 12px var(--brand-accent)' : 'none'
                        }} 
                      />
                      <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{ver.verName}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{ver.progress}% Complete</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{ver.completedSquads}/{ver.totalSquads} squads</span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* KPI Grid */}
        <div className="qa-dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          <div className="qa-kpi-card-new" style={{ '--card-glow': tone.color, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '20px' }}>
            <div style={{ flex: 1 }}>
              <div className="qa-kpi-header" style={{ marginBottom: '8px' }}>
                <span className="qa-kpi-title">Pass Rate</span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: tone.text, fontSize: '32px', marginBottom: '4px' }}>{dashPctPass}%</div>
              <div className="qa-kpi-desc">Overall passing test cases</div>
            </div>
            {renderRadialGauge(dashPctPass, <CheckSquare size={16} style={{ color: tone.color }} />, 64, 5, tone.color)}
          </div>

          <div className="qa-kpi-card-new" style={{ '--card-glow': 'var(--blue)', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '20px' }}>
            <div style={{ flex: 1 }}>
              <div className="qa-kpi-header" style={{ marginBottom: '8px' }}>
                <span className="qa-kpi-title">Execution</span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: 'var(--text-primary)', fontSize: '32px', marginBottom: '4px' }}>{pctExecuted}%</div>
              <div className="qa-kpi-desc">{s.total - s.pending} / {s.total} executed cases</div>
            </div>
            {renderRadialGauge(pctExecuted, <Activity size={16} style={{ color: 'var(--blue)' }} />, 64, 5, 'var(--blue)')}
          </div>

          <div className="qa-kpi-card-new" style={{ '--card-glow': totalIssues > 0 ? 'var(--red)' : 'var(--green)', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '20px' }}>
            <div style={{ flex: 1 }}>
              <div className="qa-kpi-header" style={{ marginBottom: '8px' }}>
                <span className="qa-kpi-title">Risk Blockers</span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: totalIssues > 0 ? 'var(--red)' : 'var(--green)', fontSize: '32px', marginBottom: '4px' }}>{totalIssues}</div>
              <div className="qa-kpi-desc">{s.fail} Fails • {s.blocked} Blocked</div>
            </div>
            {renderRadialGauge(s.total === 0 ? 0 : Math.round((totalIssues / s.total) * 100), <AlertCircle size={16} style={{ color: totalIssues > 0 ? 'var(--red)' : 'var(--green)' }} />, 64, 5, totalIssues > 0 ? 'var(--red)' : 'var(--green)')}
          </div>

          <div className="qa-kpi-card-new" style={{ '--card-glow': 'var(--brand-accent)', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '20px' }}>
            <div style={{ flex: 1 }}>
              <div className="qa-kpi-header" style={{ marginBottom: '8px' }}>
                <span className="qa-kpi-title">{isRelease ? 'Versions' : 'Squads Status'}</span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: 'var(--text-primary)', fontSize: '32px', marginBottom: '4px' }}>{completedItems}/{totalItems}</div>
              <div className="qa-kpi-desc">{isRelease ? 'Fully completed versions' : 'Fully completed squads'}</div>
            </div>
            {renderRadialGauge(overallCompletion, <Layers size={16} style={{ color: 'var(--brand-accent)' }} />, 64, 5, 'var(--brand-accent)')}
          </div>
        </div>

        {/* Progress Breakdown bar */}
        {s.total > 0 && (
          <div style={{ padding: '24px', backgroundColor: 'var(--card)', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>Combined Execution Progress</span>
              <span>{pctExecuted}% Completed</span>
            </div>
            <div className="qa-progress-bar-container-new" style={{ height: '8px' }}>
              {statusOrder.map(status => {
                const width = (s[status] / s.total) * 100;
                return width > 0 && (
                  <div
                    key={status}
                    className="qa-progress-bar-segment-new"
                    style={{
                      width: `${width}%`,
                      backgroundColor: STATUS_COLORS[status] || 'var(--neutral)',
                    }}
                    title={`${STATUS_LABELS[status]}: ${s[status]} (${Math.round(width)}%)`}
                  />
                );
              })}
            </div>
            {/* Status Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '16px' }}>
              {statusOrder.map(status => (
                s[status] > 0 && (
                  <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: STATUS_COLORS[status] }} />
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{STATUS_LABELS[status]}</span>
                    <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>({s[status]})</span>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* Main Content Layout Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '24px' }}>
          
          {/* Left Column: Versions Overview (Release Cycle) OR Squads Performance (Version) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {isRelease ? (
              <>
                <h3 style={{ fontSize: '18px', fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>Versions Overview</h3>
                <div className="qa-squad-cards-grid">
                  {versionsList.map(ver => {
                    const verOwners = Array.from(new Set(ver.squads.map(s => s.owner).filter(Boolean)));
                    const verPlatforms = {};
                    ver.squads.forEach(sq => {
                      (sq.items || []).forEach(item => {
                        const plat = item.platform || 'General';
                        const status = item.status || 'pending';
                        if (!verPlatforms[plat]) {
                          verPlatforms[plat] = { total: 0, pass: 0 };
                        }
                        verPlatforms[plat].total++;
                        if (status === 'pass' || status === 'pass_flaky') {
                          verPlatforms[plat].pass++;
                        }
                      });
                    });
                    
                    const verPlatformList = Object.entries(verPlatforms).map(([platform, p]) => {
                      const passPct = p.total === 0 ? 0 : Math.round((p.pass / p.total) * 100);
                      return { platform, passPct, total: p.total };
                    });

                    return (
                      <div 
                        key={ver.verName} 
                        className={`qa-squad-card-premium ${ver.progress === 100 ? 'completed' : ''}`}
                        onClick={() => setActiveSelection({ type: 'version', rcName: activeSelection.name, verName: ver.verName })}
                      >
                        <div className="qa-squad-card-header">
                          <div style={{ maxWidth: '70%' }}>
                            <div className="qa-squad-card-title">{ver.verName}</div>
                            <span style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginTop: '4px' }}>
                              {ver.completedSquads}/{ver.totalSquads} squads completed
                            </span>
                          </div>
                          {renderRadialGauge(ver.progress, '', 54, 4, ver.progress === 100 ? 'var(--success)' : 'var(--brand-accent)')}
                        </div>

                        <div className="qa-squad-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                            <span>Combined Pass Rate:</span>
                            <span style={{ fontWeight: 700, color: getStatusTone(ver.passRate).color }}>{ver.passRate}%</span>
                          </div>
                          
                          {/* Mini platform gauges */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                            {['Mobile', 'Web', 'API'].map(platName => {
                              const platInfo = verPlatformList.find(p => p.platform.toLowerCase() === platName.toLowerCase()) || { passPct: 0, total: 0 };
                              const color = platInfo.total > 0 ? getStatusTone(platInfo.passPct).color : 'var(--border)';
                              return (
                                <div key={platName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '10px' }}>
                                  <span style={{ width: '45px', color: 'var(--text-secondary)', fontWeight: 550 }}>{platName}</span>
                                  <div style={{ flexGrow: 1, height: '4px', backgroundColor: 'var(--border-light)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: platInfo.total > 0 ? `${platInfo.passPct}%` : '0%', backgroundColor: color, height: '100%' }} />
                                  </div>
                                  <span style={{ width: '28px', textAlign: 'right', color: 'var(--text-dim)' }}>
                                    {platInfo.total > 0 ? `${platInfo.passPct}%` : 'N/A'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="qa-squad-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                          <div className="qa-avatar-group">
                            {verOwners.slice(0, 3).map((owner, oIdx) => (
                              <div key={oIdx} className="qa-avatar-overlap" title={owner}>
                                {owner.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                            ))}
                            {verOwners.length > 3 && (
                              <div className="qa-avatar-overlap" title={`${verOwners.length - 3} more owners`}>
                                +{verOwners.length - 3}
                              </div>
                            )}
                            {verOwners.length === 0 && (
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic' }}>Unassigned</span>
                            )}
                          </div>
                          
                          <button className="qa-squad-card-action-btn">
                            Detail <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: '18px', fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>Squads Performance</h3>
                <div className="qa-squad-cards-grid">
                  {sortedSquads.map(cycle => {
                    const cycleStats = getStats(cycle);
                    const cyclePctPass = cycleStats.total === 0 ? 0 : Math.round((cycleStats.pass / cycleStats.total) * 100);
                    const cycleProgress = cycleStats.total === 0 ? 0 : Math.round(((cycleStats.total - cycleStats.pending) / cycleStats.total) * 100);
                    const isCompleted = cycleProgress === 100;
                    
                    const cyclePlatforms = getCyclePlatformStats(cycle);

                    return (
                      <div 
                        key={cycle.id} 
                        className={`qa-squad-card-premium ${isCompleted ? 'completed' : ''}`}
                        onClick={() => setActiveSelection({ type: 'squad', id: cycle.id })}
                      >
                        <div className="qa-squad-card-header">
                          <div style={{ maxWidth: '70%' }}>
                            <div className="qa-squad-card-title" title={cycle.squad || cycle.name.split('/').pop().trim()}>
                              {cycle.squad || cycle.name.split('/').pop().trim()}
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginTop: '4px' }}>
                              Build: {cycle.build_version || 'N/A'}
                            </span>
                          </div>
                          {renderRadialGauge(cycleProgress, '', 54, 4, isCompleted ? 'var(--success)' : 'var(--brand-accent)')}
                        </div>

                        <div className="qa-squad-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                            <span>Squad Pass Rate:</span>
                            <span style={{ fontWeight: 700, color: getStatusTone(cyclePctPass).color }}>{cyclePctPass}%</span>
                          </div>

                          {/* Platform breakdown */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                            {['Mobile', 'Web', 'API'].map(platName => {
                              const platInfo = cyclePlatforms.find(p => p.platform.toLowerCase() === platName.toLowerCase()) || { passPct: 0, total: 0 };
                              const color = platInfo.total > 0 ? getStatusTone(platInfo.passPct).color : 'var(--border)';
                              return (
                                <div key={platName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '10px' }}>
                                  <span style={{ width: '45px', color: 'var(--text-secondary)', fontWeight: 550 }}>{platName}</span>
                                  <div style={{ flexGrow: 1, height: '4px', backgroundColor: 'var(--border-light)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: platInfo.total > 0 ? `${platInfo.passPct}%` : '0%', backgroundColor: color, height: '100%' }} />
                                  </div>
                                  <span style={{ width: '28px', textAlign: 'right', color: 'var(--text-dim)' }}>
                                    {platInfo.total > 0 ? `${platInfo.passPct}%` : 'N/A'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="qa-squad-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {cycle.owner ? (
                              <div 
                                className="qa-avatar-overlap" 
                                title={`Owner: ${cycle.owner}`}
                                style={{ marginLeft: 0 }}
                              >
                                {cycle.owner.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic' }}>Unassigned</span>
                            )}
                            
                            {(cycleStats.fail > 0 || cycleStats.blocked > 0) && (
                              <div style={{ display: 'flex', gap: '3px' }}>
                                {cycleStats.fail > 0 && <span className="squad-issue-pill fail" style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px' }}>{cycleStats.fail}F</span>}
                                {cycleStats.blocked > 0 && <span className="squad-issue-pill blocked" style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px' }}>{cycleStats.blocked}B</span>}
                              </div>
                            )}
                          </div>
                          
                          <button className="qa-squad-card-action-btn">
                            Checklist <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Right Column: Platform Quality & Active Failures/Blockers */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Platform Performance */}
            <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 16px 0' }}>Platform Performance</h3>
              {platforms.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No platform execution data found.</div>
              ) : (
                <div className="qa-report-platform-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {platforms.map(pb => {
                    const pbTone = getStatusTone(pb.passPct);
                    return (
                      <div key={pb.platform} className="qa-platform-gauge-premium" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '13px' }}>{pb.platform}</span>
                          <span style={{ fontWeight: 750, color: pbTone.color, fontSize: '13px' }}>{pb.passPct}% Pass</span>
                        </div>
                        <div style={{ height: '6px', backgroundColor: 'var(--border-light)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${pb.completionPct}%`, backgroundColor: 'var(--brand-accent)', height: '100%', borderRadius: '3px', transition: 'width 0.4s' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                          <span>{pb.total - pb.pending} / {pb.total} Executed ({pb.completionPct}%)</span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {pb.fail > 0 && <span className="squad-issue-pill fail" style={{ fontSize: '9px', padding: '1px 4px' }}>{pb.fail}F</span>}
                            {pb.blocked > 0 && <span className="squad-issue-pill blocked" style={{ fontSize: '9px', padding: '1px 4px' }}>{pb.blocked}B</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Failures & Blockers */}
            <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 16px 0' }}>Active Issues ({issues.length})</h3>
              {issues.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px' }}>
                  🎉 No failures or blockers. Looking solid!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }} className="thin-scrollbar">
                  {issues.slice(0, 10).map(item => (
                    <div 
                      key={item.id} 
                      className="qa-issue-premium-card"
                      style={{ borderLeft: item.status === 'fail' ? '3px solid var(--danger)' : '3px solid var(--warning)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--brand-accent)' }}>{item.test_case?.zephyr_key}</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', backgroundColor: item.status === 'fail' ? 'var(--danger-dim)' : 'rgba(251, 146, 60, 0.1)', color: item.status === 'fail' ? 'var(--danger)' : 'rgb(251, 146, 60)' }}>
                          {item.status.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.checklist_label || item.test_case?.name}>
                        {item.checklist_label || item.test_case?.name}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                        <span>Squad: {item.squadName}</span>
                        <span>{item.assigned_to || 'Unassigned'}</span>
                      </div>
                    </div>
                  ))}
                  {issues.length > 10 && (
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', marginTop: '4px' }}>
                      And {issues.length - 10} more issues.
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    );
  }

  if (!activeCycle) {
    return (
      <div className="qa-main">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, backgroundColor: 'var(--card)', borderRadius: 24, border: '1px solid var(--border)', maxWidth: 440, boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}>
            <div style={{ width: 88, height: 88, borderRadius: 24, background: 'var(--brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: '0 10px 20px var(--brand-accent-dim)' }}>
              <ListChecks size={44} color="#fff"/>
            </div>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: 12, fontSize: 24, fontWeight: 800 }}>QA Checklist Portal</h2>
            <p style={{ margin: '0 auto 32px', lineHeight: 1.6, fontSize: 14, color: 'var(--text-secondary)' }}>Create structured release cycles, track manual test execution, and link bugs directly to your Zephyr test cases.</p>
            <button onClick={() => setIsImportModalOpen(true)} className="qa-btn-primary" style={{ padding: '14px 28px', fontSize: 15, margin: '0 auto' }}>
              <DownloadCloud size={20}/> Import Folder from Zephyr
            </button>
          </div>
        </div>
      </div>
    );
  }


  const isDrawerOpen = !!selectedItemForDrawer;

  return (
    <div ref={mainContainerRef} className={`qa-main ${isDrawerOpen ? 'qa-drawer-open' : ''}`}>
      {/* Header & Stats */}
      <div className="qa-main-header">
        {/* Top Title Bar */}
        <div className="qa-header-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="qa-header-title-container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1 className="qa-header-title" style={{ fontWeight: 800, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{activeCycle.name}</h1>
              <span className="qa-cycle-status-badge active">{activeCycle.status || 'Active'}</span>
              {cyclePlatformsList.map(plat => (
                <span key={plat} className="qa-platform-badge" style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '12px' }}>
                  {plat}
                </span>
              ))}
            </div>
            <div className="qa-collapsible-header-section">
              <div className="qa-header-meta-row" style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <span style={{display: 'flex', alignItems: 'center', gap: 6}}><Calendar size={13}/> Created {new Date(activeCycle.created_at).toLocaleDateString()}</span>
                <span>•</span>
                <span style={{display: 'flex', alignItems: 'center', gap: 6}}><ListChecks size={13}/> {activeCycle.items.length} cases</span>
                {activeCycle.build_version && (
                  <>
                    <span>•</span>
                    <span style={{display: 'flex', alignItems: 'center', gap: 6}}><GitBranch size={13}/> Build {activeCycle.build_version}</span>
                  </>
                )}
                {activeCycle.owner && (
                  <>
                    <span>•</span>
                    <span style={{display: 'flex', alignItems: 'center', gap: 6}}><User size={13}/> Owner: {activeCycle.owner}</span>
                  </>
                )}
                {activeCycle.deadline && (
                  <>
                    <span>•</span>
                    <span style={{display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)'}}><Calendar size={13}/> Due: {new Date(activeCycle.deadline).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={(e) => { e.stopPropagation(); setActionsMenuOpen(!actionsMenuOpen); }}
              className="qa-btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
            >
              <Settings size={14} /> Actions <ChevronDown size={14} />
            </button>
            {actionsMenuOpen && (
              <div className="qa-status-dropdown" style={{ right: 0, left: 'auto', top: '100%', marginTop: 6, width: 180, zIndex: 100 }}>
                <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); setActionsMenuOpen(false); onAddCasesClick(); }}>
                  <Plus size={14} /> Add Cases
                </div>
                <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); setActionsMenuOpen(false); onEditCycleClick(); }}>
                  <Edit size={14} /> Edit Cycle Details
                </div>
                <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); setActionsMenuOpen(false); onCloneCycleClick(); }}>
                  <Copy size={14} /> Clone / Duplicate
                </div>
                <div className="qa-dropdown-divider" />
                <div className="qa-status-option reset" onClick={(e) => { e.stopPropagation(); setActionsMenuOpen(false); onDeleteCycleClick(); }} style={{ color: 'var(--danger)' }}>
                  <Trash2 size={14} /> Delete Cycle
                </div>
              </div>
            )}
          </div>
        </div>

        {/* KPI Grid */}
        <div className="qa-collapsible-header-section">
          <div className="qa-dashboard-grid">
            <div className="qa-kpi-card-new" style={pctPass === 0 ? { opacity: 0.6 } : {}}>
              <div className="qa-kpi-header">
                <span className="qa-kpi-title">Pass Rate</span>
                <span className="qa-kpi-icon-wrapper" style={{
                  backgroundColor: getStatusTone(pctPass).bg,
                  color: getStatusTone(pctPass).text
                }}><CheckSquare size={16} /></span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: getStatusTone(pctPass).text }}>{pctPass}%</div>
              <div className="qa-kpi-desc">Overall passing test cases</div>
            </div>

            <div className="qa-kpi-card-new" style={totalBlockers === 0 ? { opacity: 0.6 } : {}}>
              <div className="qa-kpi-header">
                <span className="qa-kpi-title">Blockers</span>
                <span className="qa-kpi-icon-wrapper danger"><AlertCircle size={16} /></span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: totalBlockers > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{totalBlockers}</div>
              <div className="qa-kpi-desc">Active execution blockers</div>
            </div>

            <div className="qa-kpi-card-new" style={flakyTestCount === 0 ? { opacity: 0.6 } : {}}>
              <div className="qa-kpi-header">
                <span className="qa-kpi-title">Flaky Tests</span>
                <span className="qa-kpi-icon-wrapper warning"><AlertTriangle size={16} /></span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: flakyTestCount > 0 ? 'var(--warning)' : 'var(--text-secondary)' }}>{flakyTestCount}</div>
              <div className="qa-kpi-desc">Tests marked as pass-flaky</div>
            </div>

            <div className="qa-kpi-card-new" style={dueTodayCount === 0 ? { opacity: 0.6 } : {}}>
              <div className="qa-kpi-header">
                <span className="qa-kpi-title">Due Today</span>
                <span className="qa-kpi-icon-wrapper primary"><Calendar size={16} /></span>
              </div>
              <div className="qa-kpi-value-new" style={{ color: dueTodayCount > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{dueTodayCount}</div>
              <div className="qa-kpi-desc">Cycles reaching deadline today</div>
            </div>
          </div>
        </div>

        {/* Progress Breakdown bar */}
        {stats.total > 0 && (
          <div className="qa-collapsible-header-section">
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span>Execution Progress</span>
                <span>{Math.round(((stats.total - stats.pending) / stats.total) * 100)}% Completed</span>
              </div>
              <div className="qa-progress-bar-container-new">
                {statusOrder.map(status => (
                  progressWidths[status] > 0 && (
                    <div
                      key={status}
                      className="qa-progress-bar-segment-new"
                      style={{
                        width: `${progressWidths[status]}%`,
                        backgroundColor: STATUS_COLORS[status] || 'var(--neutral)',
                      }}
                      title={`${STATUS_LABELS[status]}: ${stats[status]} (${Math.round(progressWidths[status])}%)`}
                    />
                  )
                ))}
              </div>
              {/* Status Legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
                {statusOrder.map(status => (
                  stats[status] > 0 && (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATUS_COLORS[status] }} />
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{STATUS_LABELS[status]}</span>
                      <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>({stats[status]})</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

        {/* Toolbar */}
        <div className="qa-toolbar">
          <div className="qa-search-wrapper">
            <Search size={16} className="qa-search-icon" />
            <input
              type="text"
              className="qa-search-input"
              placeholder="Search test cases or bug IDs..."
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
            />
            {localSearch && (
              <button onClick={() => { setLocalSearch(''); setSearchQ(''); }} style={{position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer'}}>
                <X size={14}/>
              </button>
            )}
          </div>

          <div className="qa-filter-group">
            {['all', 'pending', 'pass', 'pass_flaky', 'fail', 'blocked'].map(f => (
              <button
                key={f}
                className={`qa-filter-btn ${activeFilter === f ? 'active' : ''}`}
                onClick={() => { setActiveFilter(f); setSelectedItems(new Set()); }}
              >
                {f === 'pass_flaky' ? 'Flaky' : f} {/* Display 'Flaky' for pass_flaky filter */}
                {f !== 'all' && stats[f] > 0 && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 10,
                    backgroundColor: activeFilter === f ? 'var(--brand-accent-dim)' : 'var(--bg-alt)',
                    color: activeFilter === f ? 'var(--brand-accent)' : 'var(--text-dim)'
                  }}>
                    {stats[f]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Module Selector Dropdown */}
          <div className="qa-toolbar-module-filter" style={{ marginLeft: 8 }}>
            <select
              value={activeModuleFilter}
              onChange={(e) => setActiveModuleFilter(e.target.value)}
              className="qa-module-select"
            >
              {availableModules.map(m => (
                <option key={m} value={m}>
                  {m === 'all' ? 'All Folders' : m}
                </option>
              ))}
            </select>
          </div>

          {/* Tag Selector Dropdown */}
          <div className="qa-toolbar-module-filter" style={{ marginLeft: 8 }}>
            <select
              value={activeTagFilter}
              onChange={(e) => setActiveTagFilter(e.target.value)}
              className="qa-module-select"
            >
              <option value="all">All Types</option>
              <option value="sanity">Sanity Only</option>
              <option value="regression">Regression Only</option>
            </select>
          </div>

          {/* Bulk Action Actions */}
          {selectedItems.size > 0 && (
            <div style={{ position: 'relative', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-accent)' }}>{selectedItems.size} selected</span>
              
              <button
                onClick={(e) => { e.stopPropagation(); handleBulkExport(); }}
                className="qa-btn-secondary"
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <DownloadCloud size={14} /> Export CSV
              </button>

              <div style={{ position: 'relative' }}>
                <button
                  onClick={(e) => { 
                    if (!isEditable) return;
                    e.stopPropagation(); 
                    setBulkDropOpen(!bulkDropOpen); 
                    setDropK(null); 
                    setAssignDropK(null); 
                    setPlatformDropK(null); 
                  }}
                  className="qa-btn-secondary"
                  style={{ 
                    padding: '8px 16px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8,
                    opacity: isEditable ? 1 : 0.5,
                    cursor: isEditable ? 'pointer' : 'not-allowed'
                  }}
                  disabled={!isEditable}
                >
                  Bulk Update <ChevronDown size={14} />
                </button>

                {isEditable && bulkDropOpen && (
                  <div className="qa-status-dropdown" style={{ right: 0, left: 'auto' }}>
                    <div className="qa-dropdown-group-title">Outcome States</div>
                    {['pass', 'pass_flaky', 'fail'].map(s => (
                      <div key={s}
                        className="qa-status-option"
                        onClick={(e) => { e.stopPropagation(); updateBulkItems({ status: s }); setBulkDropOpen(false); }}
                      >
                        <span style={{ color: STATUS_COLORS[s], display: 'flex' }}>{STATUS_ICONS[s] || <MinusCircle size={14}/>}</span>
                        <span style={{fontWeight: 500}}>{STATUS_LABELS[s]}</span>
                      </div>
                    ))}
                    <div className="qa-dropdown-divider" />
                    <div className="qa-dropdown-group-title">Process States</div>
                    {['hold', 'blocked', 'skip', 'na'].map(s => (
                      <div key={s}
                        className="qa-status-option"
                        onClick={(e) => { e.stopPropagation(); updateBulkItems({ status: s }); setBulkDropOpen(false); }}
                      >
                        <span style={{ color: STATUS_COLORS[s], display: 'flex' }}>{STATUS_ICONS[s] || <MinusCircle size={14}/>}</span>
                        <span style={{fontWeight: 500}}>{STATUS_LABELS[s]}</span>
                      </div>
                    ))}
                    <div className="qa-dropdown-divider" />
                    <div
                      className="qa-status-option reset"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateBulkItems({ status: 'pending' });
                        setBulkDropOpen(false);
                      }}
                      style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}
                    >
                      <span style={{ display: 'flex' }}><MinusCircle size={14}/></span>
                      <span>Clear / Reset</span>
                    </div>
                    <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); setAssignDropK('bulk'); setBulkDropOpen(false); }}>
                      <User size={14} /> Assign To...
                    </div>
                    <div className="qa-dropdown-divider" />
                    <div
                      className="qa-status-option reset"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Are you sure you want to remove the ${selectedItems.size} selected case(s) from this release cycle?`)) {
                          onRemoveSelectedItems(Array.from(selectedItems));
                          setBulkDropOpen(false);
                          setSelectedItems(new Set());
                        }
                      }}
                      style={{ color: 'var(--danger)', fontWeight: 600 }}
                    >
                      <Trash2 size={14} color="var(--danger)" /> Remove from Cycle
                    </div>
                  </div>
                )}

                {assignDropK === 'bulk' && (
                  <div className="qa-status-dropdown" style={{ right: 0, left: 'auto', top: '100%', marginTop: '6px' }}>
                    <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); updateBulkItems({ assigned_to: null }); setAssignDropK(null); }}>
                      <User size={14} /> Unassign
                    </div>
                    {availableTesters.map(tester => (
                      <div key={tester.id} className="qa-status-option" onClick={(e) => { e.stopPropagation(); updateBulkItems({ assigned_to: tester.name }); setAssignDropK(null); }}>
                        <User size={14} /> {tester.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      {/* Table (CSS Grid Layout) */}
      <div className="qa-table-container">
        <div className="qa-table">
          <div className={`qa-table-header ${isDrawerOpen ? 'drawer-open' : 'drawer-closed'}`}>
            <div className="qa-table-header-cell" style={{ display: 'flex', justifyContent: 'center' }}>
              <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedItems.size > 0 ? 'var(--brand-accent)' : 'var(--text-secondary)' }}>
                {selectedItems.size > 0 ? (
                  selectedItems.size === filteredItems.length ? <CheckSquare size={16} /> : <MinusCircle size={16} />
                ) : <Square size={16} />}
              </button>
            </div>
            <div className="qa-table-header-cell">Checklist Item</div>
            <div className="qa-table-header-cell">Platform / Status</div>
            {!isDrawerOpen && <div className="qa-table-header-cell">Assigned To</div>}
            {!isDrawerOpen && <div className="qa-table-header-cell">Issues</div>}
            {!isDrawerOpen && <div className="qa-table-header-cell" style={{ display: 'flex', justifyContent: 'center' }}>Details</div>}
          </div>
          <div className="qa-table-body">
            {visibleRows.map((row) => {
              if (row.type === 'header') {
                const { moduleName, itemsInGroup } = row;
                const groupTotal = itemsInGroup.length;
                const groupDone = itemsInGroup.filter(i => i.status !== 'pending').length;
                const groupPass = itemsInGroup.filter(i => i.status === 'pass' || i.status === 'pass_flaky').length;
                const groupFail = itemsInGroup.filter(i => i.status === 'fail').length;
                const groupBlocked = itemsInGroup.filter(i => i.status === 'blocked').length;
                const groupPct = groupTotal === 0 ? 0 : Math.round((groupPass / groupTotal) * 100);
                return (
                  <div key={`header-${moduleName}`} className="qa-table-group-header" onClick={() => toggleGroupExpand(moduleName)}>
                    <div className="qa-table-group-header-left">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: collapsedGroups.has(moduleName) ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                          <ChevronDown size={15} />
                        </span>
                        <Folder size={14} color="var(--warning)" />
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '12px' }}>{moduleName}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                          {groupDone}/{groupTotal}
                        </span>
                        {groupFail > 0 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--danger-dim)', color: 'var(--danger)', fontWeight: 700 }}>{groupFail} fail</span>}
                        {groupBlocked > 0 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--warning-dim)', color: 'var(--warning)', fontWeight: 700 }}>{groupBlocked} blocked</span>}
                      </div>
                    </div>
                    <div className="qa-table-group-header-right">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, width: 160, height: 4, borderRadius: 2, backgroundColor: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${groupPct}%`, borderRadius: 2, backgroundColor: groupPct === 100 ? 'var(--success)' : groupFail > 0 ? 'var(--danger)' : 'var(--brand-accent)', transition: 'width 0.5s ease' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{groupPct}% pass</span>
                      </div>
                    </div>
                  </div>
                );
              }

              // Row is an item
              const { item } = row;
              const isSelected = selectedItems.has(item.id);
              const needsAttention = (item.status === 'fail' || item.status === 'blocked') && !item.bug_id;
              const isPending = item.status === 'pending';
              const isFlashing = itemToFlashId === item.id;
              const checklistLabel = item.checklist_label || item.test_case?.name || 'Untitled checklist item';
              const isActive = selectedItemForDrawer?.id === item.id;
              const isAnyDropOpen = dropK === item.id || assignDropK === item.id || platformDropK === item.id;

              return (
                <div
                  key={`item-${item.id}`}
                  onClick={() => openDetailsDrawer(item)}
                  className={`qa-table-sub-row ${isFlashing ? 'qa-flash-success' : ''} ${isActive ? 'qa-row-active' : ''} ${isDrawerOpen ? 'drawer-open' : 'drawer-closed'}`}
                  style={{ 
                    backgroundColor: isSelected ? 'var(--card)' : 'transparent', 
                    boxShadow: isSelected ? 'inset 2px 0 0 var(--brand-accent)' : 'none',
                    position: isAnyDropOpen ? 'relative' : undefined,
                    zIndex: isAnyDropOpen ? 50 : undefined
                  }}
                >
                  <div className="qa-table-cell" style={{ display: 'flex', justifyContent: 'center' }} onClick={(e) => toggleSelect(item.id, e)}>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSelected ? 'var(--brand-accent)' : 'var(--text-secondary)' }}>
                      {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </div>
                  <div className="qa-table-cell">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        {checklistLabel}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--brand-accent)', fontSize: 10, backgroundColor: 'var(--brand-accent-dim)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600, width: 'fit-content' }}>
                          {item.test_case?.zephyr_key}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="qa-table-cell">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <button
                          onClick={(e) => { 
                            if (!isEditable) return;
                            e.stopPropagation(); 
                            setDropK(dropK === item.id ? null : item.id); 
                            setBulkDropOpen(false); 
                            setAssignDropK(null); 
                            setPlatformDropK(null); 
                          }}
                          className="qa-status-btn"
                          style={{
                            border: `1px solid ${isPending ? 'var(--border)' : STATUS_COLORS[item.status]}`,
                            backgroundColor: isPending ? 'var(--border-light)' : `${STATUS_COLORS[item.status]}15`,
                            color: isPending ? 'var(--text-secondary)' : STATUS_COLORS[item.status],
                            width: '100%',
                            cursor: isEditable ? 'pointer' : 'not-allowed',
                            opacity: isEditable ? 1 : 0.7
                          }}
                          disabled={!isEditable}
                        >
                          <div style={{display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                            {STATUS_ICONS[item.status]} <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{STATUS_LABELS[item.status]}</span>
                          </div>
                          {isEditable && <ChevronDown size={12} style={{opacity: 0.5, flexShrink: 0}}/>}
                        </button>
                        
                        {dropK === item.id && (
                          <div className="qa-status-dropdown">
                            <div className="qa-dropdown-group-title">Outcome States</div>
                            {['pass', 'pass_flaky', 'fail'].map(s => (
                              <div key={s}
                                className="qa-status-option"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if(item.status !== s) updateItem(item.id, { status: s });
                                  setDropK(null);
                                }}
                              >
                                <span style={{ color: STATUS_COLORS[s], display: 'flex' }}>{STATUS_ICONS[s] || <MinusCircle size={14}/>}</span>
                                <span style={{fontWeight: 500}}>{STATUS_LABELS[s]}</span>
                              </div>
                            ))}
                            
                            <div className="qa-dropdown-divider" />
                            
                            <div className="qa-dropdown-group-title">Process States</div>
                            {['hold', 'blocked', 'skip', 'na'].map(s => (
                              <div key={s}
                                className="qa-status-option"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if(item.status !== s) updateItem(item.id, { status: s });
                                  setDropK(null);
                                }}
                              >
                                <span style={{ color: STATUS_COLORS[s], display: 'flex' }}>{STATUS_ICONS[s] || <MinusCircle size={14}/>}</span>
                                <span style={{fontWeight: 500}}>{STATUS_LABELS[s]}</span>
                              </div>
                            ))}
                            
                            <div className="qa-dropdown-divider" />
                            <div
                              className="qa-status-option reset"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateItem(item.id, { status: 'pending' });
                                setDropK(null);
                              }}
                              style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}
                            >
                              <span style={{ display: 'flex' }}><MinusCircle size={14}/></span>
                              <span>Clear / Reset</span>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (isEditable) updateItem(item.id, { status: 'pass' }); }}
                          className="qa-quick-status-btn pass"
                          title="Quick Pass"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 24, height: 24, borderRadius: '50%',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            backgroundColor: item.status === 'pass' ? 'var(--success)' : 'rgba(16, 185, 129, 0.05)',
                            color: item.status === 'pass' ? '#fff' : 'var(--success)',
                            cursor: isEditable ? 'pointer' : 'not-allowed',
                            opacity: isEditable ? 1 : 0.5,
                            transition: 'all 150ms ease'
                          }}
                          disabled={!isEditable}
                        >
                          <CheckSquare size={13} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (isEditable) updateItem(item.id, { status: 'fail' }); }}
                          className="qa-quick-status-btn fail"
                          title="Quick Fail"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 24, height: 24, borderRadius: '50%',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            backgroundColor: item.status === 'fail' ? 'var(--danger)' : 'rgba(239, 68, 68, 0.05)',
                            color: item.status === 'fail' ? '#fff' : 'var(--danger)',
                            cursor: isEditable ? 'pointer' : 'not-allowed',
                            opacity: isEditable ? 1 : 0.5,
                            transition: 'all 150ms ease'
                          }}
                          disabled={!isEditable}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {!isDrawerOpen && (
                    <div className="qa-table-cell">
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={(e) => { 
                            if (!isEditable) return;
                            e.stopPropagation(); 
                            setAssignDropK(assignDropK === item.id ? null : item.id); 
                            setDropK(null); 
                            setPlatformDropK(null); 
                            setBulkDropOpen(false); 
                          }}
                          className="qa-assign-btn"
                          style={{
                            cursor: isEditable ? 'pointer' : 'not-allowed',
                            opacity: isEditable ? 1 : 0.7
                          }}
                          disabled={!isEditable}
                        >
                          <User size={14} /> {item.assigned_to ? item.assigned_to : <span className="qa-empty-placeholder">Unassigned</span>} {isEditable && <ChevronDown size={14} style={{opacity: 0.5}}/>}
                        </button>
                        {assignDropK === item.id && (
                          <div className="qa-status-dropdown" style={{ left: 0, right: 'auto' }}>
                            <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); updateItem(item.id, { assigned_to: null }); setAssignDropK(null); }}>
                              <User size={14} /> Unassign
                            </div>
                            {availableTesters.map(tester => (
                              <div key={tester.id} className="qa-status-option" onClick={(e) => { e.stopPropagation(); updateItem(item.id, { assigned_to: tester.name }); setAssignDropK(null); }}>
                                <User size={14} /> {tester.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!isDrawerOpen && (
                    <div className="qa-table-cell">
                      {item.bug_id ? (
                        <div style={{display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start'}}>
                          <span style={{ color: 'var(--danger)', fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--danger-dim)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--danger)', display: 'inline-block' }}>
                            {item.bug_id}
                          </span>
                          <JiraStatus issueKey={item.bug_id} />
                        </div>
                      ) : needsAttention ? (
                        <span style={{ color: 'var(--warning)', fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--warning-dim)', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--warning)' }}>
                          <AlertTriangle size={14}/> Needs Bug ID
                        </span>
                      ) : <span className="qa-empty-placeholder">—</span>}
                    </div>
                  )}

                  {!isDrawerOpen && (
                    <div className="qa-table-cell" style={{ display: 'flex', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '8px', backgroundColor: item.notes ? 'var(--brand-accent-dim)' : 'transparent', color: item.notes ? 'var(--brand-accent)' : 'var(--text-secondary)' }}>
                          <FileText size={16} />
                          {item.notes && <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, backgroundColor: 'var(--brand-accent)', borderRadius: '50%', border: '2px solid var(--surface)' }}></span>}
                        </div>
                        <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderRadius: '6px', transition: 'all 0.2s' }}>
                          <ChevronDown size={16} color="var(--text-secondary)"/>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {tableRows.length > 0 && (
              <div className="qa-pagination-controls" style={{ 
                position: 'sticky', 
                bottom: 0, 
                zIndex: 20, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                padding: '12px 24px', 
                borderTop: '1px solid var(--border)', 
                backgroundColor: 'var(--surface)',
                boxShadow: '0 -4px 12px rgba(0,0,0,0.1)' 
              }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, tableRows.length)} of {tableRows.length} rows
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="qa-btn-secondary"
                    style={{ padding: '6px 12px', opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    Previous
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, idx) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = idx + 1;
                      } else if (currentPage <= 3) {
                        pageNum = idx + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + idx;
                      } else {
                        pageNum = currentPage - 2 + idx;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          style={{
                            width: '32px', height: '32px', borderRadius: '6px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: pageNum === currentPage ? '1px solid var(--brand-accent)' : '1px solid transparent',
                            backgroundColor: pageNum === currentPage ? 'var(--brand-accent-dim)' : 'transparent',
                            color: pageNum === currentPage ? 'var(--brand-accent)' : 'var(--text-secondary)',
                            fontWeight: pageNum === currentPage ? 700 : 500,
                            cursor: 'pointer', fontSize: '13px', transition: 'all 0.2s'
                          }}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="qa-btn-secondary"
                    style={{ padding: '6px 12px', opacity: currentPage === totalPages ? 0.5 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
 
      {drawerItem && (
        <RightDetailsDrawer
          key={drawerItem.id}
          item={drawerItem}
          isOpen={isDrawerTransitionOpen}
          onClose={closeDetailsDrawer}
          updateItem={updateItem}
          availableTesters={availableTesters}
          isCycleLocked={activeCycle?.is_locked}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};

export default MainContent;