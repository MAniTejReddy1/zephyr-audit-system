import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Calendar, ListChecks, FileText, Search, X, ChevronDown, CheckSquare, Square, Folder, AlertTriangle, ChevronUp, AlertCircle, DownloadCloud, Plus, RefreshCw, MinusCircle, User, Upload } from 'lucide-react'; // Added Upload icon
import Badge from '../ui/Badge';
import JiraStatus from './JiraStatus';
import FolderSelect from './FolderSelect';
import { STATUS_ICONS, STATUS_COLORS, STATUS_LABELS } from '../../constants.jsx';
import RightDetailsDrawer from './RightDetailsDrawer.jsx';
import './MainContent.css';

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
  availableTesters
}) => {
  const [progressWidths, setProgressWidths] = useState({});
  const [selectedItemForDrawer, setSelectedItemForDrawer] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [assignDropK, setAssignDropK] = useState(null); // State for individual assignment dropdown

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
      const testCaseName = item.test_case?.name || 'Uncategorized';
      if (!groups.has(testCaseName)) {
        groups.set(testCaseName, []);
      }
      groups.get(testCaseName).push(item);
    });
    return Array.from(groups.entries());
  }, [filteredItems]);

  const toggleGroupExpand = useCallback((testCaseName) => {
    setExpandedGroups(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(testCaseName)) {
        newExpanded.delete(testCaseName);
      } else {
        newExpanded.add(testCaseName);
      }
      return newExpanded;
    });
  }, []);

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

  const statusOrder = ['pass', 'pass_flaky', 'fail', 'blocked', 'pending', 'skip', 'na', 'hold'];

  const openDetailsDrawer = useCallback((item) => {
    setSelectedItemForDrawer(item);
  }, []);

  const closeDetailsDrawer = useCallback(() => {
    setSelectedItemForDrawer(null);
  }, []);

  const closeDropdowns = useCallback(() => {
    setDropK(null);
    setBulkDropOpen(false);
    setAssignDropK(null); // Close assignment dropdown
  }, []);

  useEffect(() => {
    document.addEventListener('click', closeDropdowns);
    return () => document.removeEventListener('click', closeDropdowns);
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
      link.setAttribute('download', `cycle_${activeCycle.name}_selected_items.csv`);
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


  return (
    <div className="qa-main">
      {/* Header & Stats */}
      <div className="qa-main-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 12px 0', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{activeCycle.name}</h1>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{display: 'flex', alignItems: 'center', gap: 6}}><Calendar size={14}/> Created {new Date(activeCycle.created_at).toLocaleDateString()}</span>
              <span>•</span>
              <span style={{display: 'flex', alignItems: 'center', gap: 6}}><ListChecks size={14}/> {activeCycle.items.length} total items</span>
            </div>
          </div>
          <div className="qa-kpi-strip">
            <div className="qa-kpi-card">
              <div className="qa-kpi-value" style={{ color: 'var(--success)' }}>{pctPass}%</div>
              <div className="qa-kpi-label">Pass Rate</div>
            </div>
            <div className="qa-kpi-card">
              <div className="qa-kpi-value" style={{ color: 'var(--danger)' }}>{totalBlockers}</div>
              <div className="qa-kpi-label">Blockers</div>
            </div>
            <div className="qa-kpi-card">
              <div className="qa-kpi-value" style={{ color: 'var(--warning)' }}>{flakyTestCount}</div>
              <div className="qa-kpi-label">Flaky Tests</div>
            </div>
            <div className="qa-kpi-card">
              <div className="qa-kpi-value" style={{ color: dueTodayCount > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{dueTodayCount}</div>
              <div className="qa-kpi-label">Due Today</div>
            </div>
            {stats.total > 0 && (
              <div className="qa-progress-bar-container">
                {statusOrder.map(status => (
                  <div
                    key={status}
                    className="qa-progress-bar-segment"
                    style={{
                      width: `${progressWidths[status] || 0}%`,
                      backgroundColor: STATUS_COLORS[status] || 'var(--neutral)',
                    }}
                  ></div>
                ))}
              </div>
            )}
            <button onClick={() => setIsReportOpen(true)} className="qa-btn-primary">
              <FileText size={18}/> View Report
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="qa-toolbar">
          <div className="qa-search-wrapper">
            <Search size={16} className="qa-search-icon" />
            <input
              type="text"
              className="qa-search-input"
              placeholder="Search test cases or bug IDs..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button onClick={() => setSearchQ('')} style={{position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer'}}>
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

          {/* Bulk Action Actions */}
          {selectedItems.size > 0 && (
            <div style={{ position: 'relative', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-accent)' }}>{selectedItems.size} selected</span>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setBulkDropOpen(!bulkDropOpen); setDropK(null); setAssignDropK(null); }}
                  className="qa-btn-secondary"
                  style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  Bulk Update <ChevronDown size={14} />
                </button>


                {bulkDropOpen && (
                  <div className="qa-status-dropdown" style={{ right: 0, left: 'auto' }}>
                    {Object.keys(STATUS_LABELS).map(s => (
                      <div key={s}
                        className="qa-status-option"
                        onClick={(e) => { e.stopPropagation(); updateBulkItems({ status: s }); }}
                      >
                        <span style={{ color: STATUS_COLORS[s], display: 'flex' }}>{STATUS_ICONS[s] || <MinusCircle size={14}/>}</span>
                        <span style={{fontWeight: 500}}>{STATUS_LABELS[s]}</span>
                      </div>
                    ))}
                    <div className="qa-status-dropdown-divider"></div> {/* Divider */}
                    <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); setAssignDropK('bulk'); setBulkDropOpen(false); }}>
                      <User size={14} /> Assign To...
                    </div>
                    <div className="qa-status-option" onClick={(e) => { e.stopPropagation(); handleBulkExport(); }}>
                      <DownloadCloud size={14} /> Export to CSV
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
      </div>

      {/* Table */}
      <div className="qa-table-container">
        <table className="qa-table">
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: 'center' }}>
                <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedItems.size > 0 ? 'var(--brand-accent)' : 'var(--text-secondary)' }}>
                  {selectedItems.size > 0 && selectedItems.size === filteredItems.length ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
              </th>
              <th style={{ width: 200 }}>Sub-feature</th>
              <th style={{ width: 120 }}>Platform/Env</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 150 }}>Assigned To</th>
              <th>Folder Scope</th>
              <th>Issues</th>
              <th style={{ width: 100, textAlign: 'center' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {groupedItems.map(([testCaseName, itemsInGroup]) => (
              <React.Fragment key={testCaseName}>
                <tr className="qa-table-group-header" onClick={() => toggleGroupExpand(testCaseName)}>
                  <td colSpan="3"> {/* Spanning checkbox, sub-feature, and platform */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {expandedGroups.has(testCaseName) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {testCaseName}
                    </div>
                  </td>
                  <td colSpan="5"></td> {/* Remaining columns */}
                </tr>

                {expandedGroups.has(testCaseName) && itemsInGroup.map(item => {
                  const isSelected = selectedItems.has(item.id);
                  const needsAttention = (item.status === 'fail' || item.status === 'blocked') && !item.bug_id;
                  const isPending = item.status === 'pending';
                  const isFlashing = itemToFlashId === item.id;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => openDetailsDrawer(item)}
                      className={`qa-table-sub-row ${isFlashing ? 'qa-flash-success' : ''}`}
                      style={{ backgroundColor: isSelected ? 'var(--card)' : 'transparent', boxShadow: isSelected ? 'inset 2px 0 0 var(--brand-accent)' : 'none' }}
                    >
                      <td style={{ textAlign: 'center' }} onClick={(e) => toggleSelect(item.id, e)}>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSelected ? 'var(--brand-accent)' : 'var(--text-secondary)' }}>
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>
                      <td></td> {/* Empty for sub-feature column */}
                      <td>
                        <Badge size="sm" color="var(--neutral)">{item.platform || 'N/A'}</Badge>
                      </td>
                      <td>
                        <div style={{ position: 'relative' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDropK(dropK === item.id ? null : item.id); setBulkDropOpen(false); setAssignDropK(null); }}
                            className="qa-status-btn"
                            style={{
                              border: `1px solid ${isPending ? 'var(--border)' : STATUS_COLORS[item.status]}`,
                              backgroundColor: isPending ? 'var(--border-light)' : `${STATUS_COLORS[item.status]}15`,
                              color: isPending ? 'var(--text-secondary)' : STATUS_COLORS[item.status],
                            }}
                          >
                            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                              {STATUS_ICONS[item.status]} <span>{STATUS_LABELS[item.status]}</span>
                            </div>
                            <ChevronDown size={14} style={{opacity: 0.5}}/>
                          </button>

                          {dropK === item.id && (
                            <div className="qa-status-dropdown">
                              {Object.keys(STATUS_LABELS).map(s => (
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
                            </div>
                          )}
                        </div>
                      </td>


                      <td> {/* Assigned To column */}
                        <div style={{ position: 'relative' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setAssignDropK(assignDropK === item.id ? null : item.id); setDropK(null); setBulkDropOpen(false); }}
                            className="qa-assign-btn"
                          >
                            <User size={14} /> {item.assigned_to || 'Unassigned'} <ChevronDown size={14} style={{opacity: 0.5}}/>
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
                      </td>

                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--border-light)', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500}}>
                          <Folder size={14} color="var(--warning)"/>
                          {item.test_case?.folder_path?.split(' > ').pop() || 'Root'}
                        </div>
                      </td>

                      <td>
                        {item.bug_id ? (
                          <div style={{display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start'}}>
                            <span style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 700, backgroundColor: 'var(--danger-dim)', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--danger)', display: 'inline-block' }}>
                              {item.bug_id}
                            </span>
                            <JiraStatus issueKey={item.bug_id} />
                          </div>
                        ) : needsAttention ? (
                          <span style={{ color: 'var(--warning)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--warning-dim)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--warning)' }}>
                            <AlertTriangle size={14}/> Needs Bug ID
                          </span>
                        ) : <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>—</span>}
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '8px', backgroundColor: item.notes ? 'var(--brand-accent-dim)' : 'transparent', color: item.notes ? 'var(--brand-accent)' : 'var(--text-secondary)' }}>
                            <FileText size={16} />
                            {item.notes && <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, backgroundColor: 'var(--brand-accent)', borderRadius: '50%', border: '2px solid var(--surface)' }}></span>}
                          </div>
                          <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderRadius: '6px', transition: 'all 0.2s' }}>
                            <ChevronDown size={16} color="var(--text-secondary)"/>
                          </div>
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {selectedItemForDrawer && (
        <RightDetailsDrawer
          item={selectedItemForDrawer}
          onClose={closeDetailsDrawer}
          updateItem={updateItem}
        />
      )}
    </div>
  );
};

export default MainContent;