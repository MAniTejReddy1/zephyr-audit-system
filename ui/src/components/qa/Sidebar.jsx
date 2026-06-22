import React, { useMemo, useState, useEffect } from 'react';
import { ListChecks, Plus, ChevronDown, Search, X, Calendar, User, AlertCircle, Package, GitBranch } from 'lucide-react';
import './Sidebar.css';

const getInitials = (name) => {
  if (!name) return '??';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const getDeadlineInfo = (deadlineStr) => {
  if (!deadlineStr) return null;
  const deadlineDate = new Date(deadlineStr);
  const today = new Date();
  // Clear times to compare dates
  const dDate = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
  const tDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isOverdue = dDate < tDate;
  
  return {
    text: deadlineDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    isOverdue
  };
};

const normalizeVerName = (v) => {
  if (!v) return 'v1.0.0';
  let cleaned = v.trim();
  cleaned = cleaned.replace(/^v\.+/i, 'v');
  if (cleaned.startsWith('V')) {
    cleaned = 'v' + cleaned.slice(1);
  }
  return cleaned;
};

const Sidebar = ({ 
  cycles, 
  activeSelection, 
  setActiveSelection, 
  setIsImportModalOpen, 
  activeCycle,
  onAddVersionClick,
  onAddSquadClick,
  onSignOffClick,
  onReopenClick
}) => {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'active', 'signed-off'

  // Auto-expand active cycle's folders on mount or change
  useEffect(() => {
    if (activeCycle) {
      const rc = activeCycle.release_cycle || activeCycle.name || "General Release";
      const ver = activeCycle.version || "v1.0.0";
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.add(rc);
        next.add(`${rc} / ${normalizeVerName(ver)}`);
        return next;
      });
    }
  }, [activeCycle]);

  // Compute processed, filtered and grouped cycles
  const groupedCycles = useMemo(() => {
    const processed = cycles.map(c => {
      let rc = c.release_cycle;
      let ver = c.version;
      let squad = c.squad;
      
      // Fallback parser for legacy database cycles
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
      
      const total = c.items?.length || 0;
      const done = c.items ? c.items.filter(i => i.status !== 'pending').length : 0;
      const fails = c.items ? c.items.filter(i => i.status === 'fail').length : 0;
      const blocked = c.items ? c.items.filter(i => i.status === 'blocked').length : 0;
      const pct = total === 0 ? 0 : Math.round((done / total) * 100);
      const isCompleted = pct === 100;
      
      return {
        ...c,
        rcName: rc,
        verName: normalizeVerName(ver),
        squadName: squad,
        total,
        done,
        fails,
        blocked,
        pct,
        isCompleted
      };
    });

    // Apply filters
    const filtered = processed.filter(c => {
      // Status Filter
      if (statusFilter === 'active' && c.status === 'Signed Off') return false;
      if (statusFilter === 'signed-off' && c.status !== 'Signed Off') return false;
      
      // Search Query Filter
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchesSquad = c.squadName.toLowerCase().includes(q);
        const matchesRC = c.rcName.toLowerCase().includes(q);
        const matchesVer = c.verName.toLowerCase().includes(q);
        const matchesOwner = c.owner ? c.owner.toLowerCase().includes(q) : false;
        const matchesBuild = c.build_version ? c.build_version.toLowerCase().includes(q) : false;
        return matchesSquad || matchesRC || matchesVer || matchesOwner || matchesBuild;
      }
      
      return true;
    });

    // Group cycles by RC and Version
    const map = new Map();
    filtered.forEach(c => {
      if (!map.has(c.rcName)) {
        map.set(c.rcName, new Map());
      }
      const rcMap = map.get(c.rcName);
      if (!rcMap.has(c.verName)) {
        rcMap.set(c.verName, []);
      }
      rcMap.get(c.verName).push(c);
    });

    // Helper to get maximum creation time of cycles in a versions map
    const getRcMaxTime = (versionsMap) => {
      let maxTime = 0;
      versionsMap.forEach((squads) => {
        squads.forEach(c => {
          const t = c.created_at ? new Date(c.created_at).getTime() : (c.id || 0);
          if (t > maxTime) maxTime = t;
        });
      });
      return maxTime;
    };

    // Helper to get maximum creation time of cycles in a squads list
    const getVerMaxTime = (squads) => {
      let maxTime = 0;
      squads.forEach(c => {
        const t = c.created_at ? new Date(c.created_at).getTime() : (c.id || 0);
        if (t > maxTime) maxTime = t;
      });
      return maxTime;
    };

    // Build structured output with aggregates
    return Array.from(map.entries())
      .sort((a, b) => getRcMaxTime(b[1]) - getRcMaxTime(a[1])) // Sort Release Cycles descending by latest cycle
      .map(([rcName, versionsMap]) => {
        const versions = Array.from(versionsMap.entries())
          .sort((a, b) => getVerMaxTime(b[1]) - getVerMaxTime(a[1])) // Sort Versions descending by latest cycle
          .map(([verName, squads]) => {
            const sortedSquads = squads.sort((a, b) => a.squadName.localeCompare(b.squadName));
            
            // Calculate Version Level stats
            const verTotal = sortedSquads.reduce((acc, s) => acc + s.total, 0);
            const verDone = sortedSquads.reduce((acc, s) => acc + s.done, 0);
            const verPct = verTotal === 0 ? 0 : Math.round((verDone / verTotal) * 100);
            const verCompletedSquads = sortedSquads.filter(s => s.isCompleted).length;
            const verTotalSquads = sortedSquads.length;
            
            return {
              verName,
              squads: sortedSquads,
              total: verTotal,
              done: verDone,
              pct: verPct,
              completedSquads: verCompletedSquads,
              totalSquads: verTotalSquads
            };
          });

        // Calculate Release Cycle Level stats
        const rcTotal = versions.reduce((acc, v) => acc + v.total, 0);
        const rcDone = versions.reduce((acc, v) => acc + v.done, 0);
        const rcPct = rcTotal === 0 ? 0 : Math.round((rcDone / rcTotal) * 100);
        const rcCompletedSquads = versions.reduce((acc, v) => acc + v.completedSquads, 0);
        const rcTotalSquads = versions.reduce((acc, v) => acc + v.totalSquads, 0);

        return {
          rcName,
          versions,
          total: rcTotal,
          done: rcDone,
          pct: rcPct,
          completedSquads: rcCompletedSquads,
          totalSquads: rcTotalSquads
        };
      });
  }, [cycles, searchQuery, statusFilter]);

  // Auto-expand search matches
  useEffect(() => {
    if (searchQuery.trim() !== '') {
      const next = new Set();
      groupedCycles.forEach(({ rcName, versions }) => {
        next.add(rcName);
        versions.forEach(({ verName }) => {
          next.add(`${rcName} / ${verName}`);
        });
      });
      setExpandedFolders(next);
    }
  }, [searchQuery, groupedCycles]);

  const toggleFolder = (folderKey) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderKey)) {
        next.delete(folderKey);
      } else {
        next.add(folderKey);
      }
      return next;
    });
  };

  const isNewButtonDisabled = false;

  return (
    <div className="qa-sidebar">
      <div className="qa-sidebar-header">
        <h2 style={{ fontSize: 14, fontWeight: 750, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ListChecks size={18} color="var(--brand-accent)" />
          <span>Release Portal</span>
        </h2>
        <button 
          onClick={() => setIsImportModalOpen(true)} 
          className="qa-btn-secondary" 
          style={{ padding: '6px 12px', fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}
          disabled={isNewButtonDisabled}
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="qa-sidebar-controls">
        <div className="qa-sidebar-search-box">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Search cycle, squad, owner..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="qa-sidebar-search-input"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="search-clear-btn" aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="qa-sidebar-tabs">
          <button 
            className={`qa-sidebar-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
          <button 
            className={`qa-sidebar-tab ${statusFilter === 'active' ? 'active' : ''}`}
            onClick={() => setStatusFilter('active')}
          >
            Active
          </button>
          <button 
            className={`qa-sidebar-tab ${statusFilter === 'signed-off' ? 'active' : ''}`}
            onClick={() => setStatusFilter('signed-off')}
          >
            Signed Off
          </button>
        </div>
      </div>

      {/* Cycle Tree */}
      <div className="qa-cycle-tree-container thin-scrollbar">
        {groupedCycles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <ListChecks size={40} color="var(--border)" style={{marginBottom: 16, opacity: 0.5}}/>
            <div style={{color: 'var(--text-primary)', fontWeight: 600, marginBottom: 8, fontSize: 13}}>No matching cycles</div>
            <div style={{color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5}}>Try refining your search query or filters.</div>
          </div>
        ) : (
          groupedCycles.map(({ rcName, versions, completedSquads, totalSquads, pct }) => {
            const isRcExpanded = expandedFolders.has(rcName);
            return (
              <div key={rcName} className="qa-tree-rc-node">
                <div 
                  className={`qa-tree-folder-header rc-level ${activeSelection?.type === 'release' && activeSelection?.name === rcName ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSelection({ type: 'release', name: rcName });
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                    <span 
                      className={`qa-tree-chevron ${isRcExpanded ? 'expanded' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFolder(rcName);
                      }}
                      style={{ cursor: 'pointer', padding: 2, margin: -2, borderRadius: 4 }}
                    >
                      <ChevronDown size={14} />
                    </span>
                    <Package size={14} style={{ color: 'var(--brand-accent)', flexShrink: 0 }} />
                    <span className="qa-tree-folder-name" title={rcName}>{rcName}</span>
                  </div>
                  <div className="qa-tree-folder-stats">
                    <button 
                      className="qa-tree-quick-action" 
                      onClick={(e) => { e.stopPropagation(); onAddVersionClick(rcName); }}
                      title="Add Version to Release Cycle"
                      style={{ marginRight: 4 }}
                    >
                      <Plus size={11} />
                    </button>
                    <span className="squad-fraction" title="Completed Squads">{completedSquads}/{totalSquads} sq</span>
                    <span className="percent-progress">{pct}%</span>
                  </div>
                </div>

                {isRcExpanded && (
                  <div className="qa-tree-rc-children">
                    {versions.map(({ verName, squads, completedSquads: vCompleted, totalSquads: vTotal, pct: vPct }) => {
                      const verKey = `${rcName} / ${verName}`;
                      const isVerExpanded = expandedFolders.has(verKey);
                      return (
                        <div key={verName} className="qa-tree-ver-node">
                          <div 
                            className={`qa-tree-folder-header ver-level ${activeSelection?.type === 'version' && activeSelection?.rcName === rcName && activeSelection?.verName === verName ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSelection({ type: 'version', rcName, verName });
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                              <span 
                                className={`qa-tree-chevron ${isVerExpanded ? 'expanded' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFolder(verKey);
                                }}
                                style={{ cursor: 'pointer', padding: 2, margin: -2, borderRadius: 4 }}
                              >
                                <ChevronDown size={13} />
                              </span>
                              <GitBranch size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                              <span className="qa-tree-folder-name" title={verName}>{verName}</span>
                            </div>
                            <div className="qa-tree-folder-stats">
                              <button 
                                className="qa-tree-quick-action" 
                                onClick={(e) => { e.stopPropagation(); onAddSquadClick(rcName, verName); }}
                                title="Add Squad to Version"
                                style={{ marginRight: 4 }}
                              >
                                <Plus size={11} />
                              </button>
                              <span className="squad-fraction">{vCompleted}/{vTotal} sq</span>
                              <span className="percent-progress">{vPct}%</span>
                            </div>
                          </div>

                          {isVerExpanded && (
                            <div className="qa-tree-ver-children">
                              {squads.map(cycle => {
                                const isSquadActive = activeSelection?.type === 'squad' && activeSelection?.id === cycle.id;
                                const deadlineInfo = getDeadlineInfo(cycle.deadline);
                                const statusDotClass = cycle.isCompleted 
                                  ? 'status-dot completed' 
                                  : cycle.pct > 0 
                                    ? 'status-dot in-progress' 
                                    : 'status-dot unstarted';
                                
                                return (
                                  <div 
                                    key={cycle.id}
                                    onClick={() => setActiveSelection({ type: 'squad', id: cycle.id })}
                                    className={`qa-tree-leaf squad-level ${isSquadActive ? 'active' : ''}`}
                                  >
                                    <div className="qa-tree-leaf-main">
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                                        <span className={statusDotClass} />
                                        <span className="qa-tree-leaf-name" title={cycle.squadName}>{cycle.squadName}</span>
                                      </div>
                                      
                                      {/* Issue counts & progress */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                        {cycle.status === 'Signed Off' ? (
                                          <button
                                            className="qa-tree-quick-action reopen"
                                            onClick={(e) => { e.stopPropagation(); onReopenClick(cycle); }}
                                            title="Reopen Cycle"
                                            style={{ padding: '2px 4px' }}
                                          >
                                            <AlertCircle size={10} style={{ color: 'var(--warning)' }} />
                                          </button>
                                        ) : (
                                          <button
                                            className="qa-tree-quick-action signoff"
                                            onClick={(e) => { e.stopPropagation(); onSignOffClick(cycle); }}
                                            title="Sign Off Cycle"
                                            style={{ padding: '2px 4px' }}
                                          >
                                            <ListChecks size={10} style={{ color: 'var(--success)' }} />
                                          </button>
                                        )}
                                        {(cycle.fails > 0 || cycle.blocked > 0) && (
                                          <div style={{ display: 'flex', gap: 3 }}>
                                            {cycle.fails > 0 && <span className="qa-leaf-issue-indicator fail">{cycle.fails}F</span>}
                                            {cycle.blocked > 0 && <span className="qa-leaf-issue-indicator blocked">{cycle.blocked}B</span>}
                                          </div>
                                        )}
                                        <span className={`qa-tree-progress-badge ${cycle.isCompleted ? 'completed' : ''}`}>
                                          {cycle.isCompleted ? '✓ 100%' : `${cycle.pct}%`}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Squad rich metadata row */}
                                    <div className="qa-tree-leaf-subinfo">
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                        {cycle.owner && (
                                          <span className="qa-leaf-owner-avatar" title={`Owner: ${cycle.owner}`}>
                                            {getInitials(cycle.owner)}
                                          </span>
                                        )}
                                        {cycle.build_version && (
                                          <span className="qa-leaf-build-tag" title={`Build version: ${cycle.build_version}`}>
                                            #{cycle.build_version.replace(/^(build|b)/i, '')}
                                          </span>
                                        )}
                                      </div>
                                      {deadlineInfo && (
                                        <span className={`qa-leaf-deadline-tag ${deadlineInfo.isOverdue ? 'overdue' : ''}`} title={deadlineInfo.isOverdue ? "Overdue deadline" : "Target deadline"}>
                                          <Calendar size={10} />
                                          {deadlineInfo.text}
                                        </span>
                                      )}
                                    </div>

                                    {/* Linear progress bar */}
                                    <div className="qa-leaf-progress-bar-container">
                                      <div 
                                        className="qa-leaf-progress-bar-fill" 
                                        style={{ 
                                          width: `${cycle.pct}%`,
                                          backgroundColor: cycle.isCompleted ? 'var(--success)' : 'var(--brand-accent)'
                                        }} 
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Sidebar;