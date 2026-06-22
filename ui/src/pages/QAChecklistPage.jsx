import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../utils';
import Sidebar from '../components/qa/Sidebar';
import MainContent from '../components/qa/MainContent';
import { STATUS_ICONS, STATUS_COLORS, STATUS_LABELS } from '../constants.jsx';
import './QAChecklistPage.css';
import { XCircle, TrendingUp, AlertTriangle, Users, Layers, Activity, ChevronUp, ChevronDown, ListChecks } from 'lucide-react';
import TableSkeletonLoader from '../components/qa/TableSkeletonLoader.jsx'; // Import the new skeleton loader
import ConfirmationModal from '../components/qa/ConfirmationModal.jsx'; // Import new modal component
import ReopenCycleModal from '../components/qa/ReopenCycleModal.jsx'; // Import ReopenCycleModal
import FolderSelect from '../components/qa/FolderSelect.jsx'; // Import FolderSelect
import JiraStatus from '../components/qa/JiraStatus.jsx';

const WS_BASE = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000/ws';

const QAChecklistPage = () => {
  const [cycles, setCycles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeSelection, setActiveSelection] = useState(null);
  const activeCycleId = activeSelection?.type === 'squad' ? activeSelection.id : null;
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(true); // New state for WebSocket connection status
  const [itemToFlashId, setItemToFlashId] = useState(null); // New state for flashing item
  
  // Table state
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQ, setSearchQ] = useState('');
  const [expanded, setExpanded] = new Set(); // No longer used for inline expansion
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [dropK, setDropK] = useState(null);
  const [bulkDropOpen, setBulkDropOpen] = useState(false);
  const [activeModuleFilter, setActiveModuleFilter] = useState('all'); // New state for module filtering
  const [activeTagFilter, setActiveTagFilter] = useState('all'); // New state for sanity/regression filtering

  // Modal states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [importFolderIds, setImportFolderIds] = useState([]);
  const [importCycleName, setImportCycleName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  // Modal filters state
  const [importReleaseCycle, setImportReleaseCycle] = useState('');
  const [importVersion, setImportVersion] = useState('');
  const [importSquad, setImportSquad] = useState('');
  const [importPlatforms, setImportPlatforms] = useState({
    Mobile: false,
    Web: false,
    API: false
  });
  const [importCaseType, setImportCaseType] = useState('all'); // all, manual, automated
  const [importPriorities, setImportPriorities] = useState({
    High: true,
    Normal: true,
    Low: true
  });
  const [importLabels, setImportLabels] = useState({
    sanity: false,
    regression: false
  });
  const [isCycleNameTouched, setIsCycleNameTouched] = useState(false);
  const [previewCount, setPreviewCount] = useState(null);
  const [loadingPreviewCount, setLoadingPreviewCount] = useState(false);

  // Dependency Cascade Modal State
  const [showCascadeModal, setShowCascadeModal] = useState(false);
  const [itemToCascade, setItemToCascade] = useState(null); // Stores the parent item that triggered the cascade

  // Reopen Cycle Modal State
  const [showReopenCycleModal, setShowReopenCycleModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true); // Placeholder for admin role check

  // WebSocket reconnect ref
  const wsRef = useRef(null);
  const reconnectTimeout = useRef(1000);

  // Testers list (initialized with defaults, populated from backend)
  const [availableTesters, setAvailableTesters] = useState([
    { id: 'tester1', name: 'Alice Smith' },
    { id: 'tester2', name: 'Bob Johnson' },
    { id: 'tester3', name: 'Charlie Brown' },
    { id: 'tester4', name: 'Diana Prince' },
  ]);

  const updateCycleNameFromParts = (release, ver, sqd) => {
    if (!isCycleNameTouched) {
      const parts = [];
      if (release) parts.push(release);
      if (ver) parts.push(ver);
      if (sqd) parts.push(sqd);
      setImportCycleName(parts.join(' / '));
    }
  };

  const handleReleaseCycleChange = (val) => {
    setImportReleaseCycle(val);
    updateCycleNameFromParts(val, importVersion, importSquad);
  };
  const handleVersionChange = (val) => {
    setImportVersion(val);
    updateCycleNameFromParts(importReleaseCycle, val, importSquad);
  };
  const handleSquadChange = (val) => {
    setImportSquad(val);
    updateCycleNameFromParts(importReleaseCycle, importVersion, val);
  };

  const fetchData = useCallback(async () => {
    try {
      const [cyclesData, foldersData, actorsData] = await Promise.all([
        apiFetch('/cycles'),
        apiFetch('/folders?with_counts=true'),
        apiFetch('/actors').catch(err => {
          console.error('Failed to fetch actors, using static defaults:', err);
          return null;
        })
      ]);
      // Simulate adding status and is_locked for demonstration
      const processedCycles = cyclesData.map(cycle => ({
        ...cycle,
        status: cycle.status || 'Active', // Default status
        is_locked: cycle.status === 'Signed Off' // Locked if Signed Off
      }));
      setCycles(processedCycles);
      setFolders(foldersData);
      
      if (actorsData && Array.isArray(actorsData)) {
        setAvailableTesters(actorsData.map(u => ({ id: u.account_id, name: u.display_name })));
      }

      if (processedCycles.length > 0 && !activeSelection) {
        setActiveSelection({ type: 'squad', id: processedCycles[0].id });
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeCycleId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isImportModalOpen || importFolderIds.length === 0) {
      setPreviewCount(null);
      return;
    }

    const controller = new AbortController();
    const fetchPreviewCount = async () => {
      setLoadingPreviewCount(true);
      try {
        const queryParams = new URLSearchParams();
        importFolderIds.forEach(id => queryParams.append('folder_id', id));
        if (importCaseType !== 'all') {
          queryParams.append('case_type', importCaseType);
        }
        Object.entries(importPriorities).forEach(([p, checked]) => {
          if (checked) {
            queryParams.append('priorities', p);
          }
        });
        Object.entries(importLabels).forEach(([lbl, checked]) => {
          if (checked) {
            queryParams.append('labels', lbl);
          }
        });

        const data = await apiFetch(`/cycles/preview_import_count?${queryParams.toString()}`, {
          signal: controller.signal
        });
        setPreviewCount(data.count);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch preview count:', err);
        }
      } finally {
        setLoadingPreviewCount(false);
      }
    };

    const timer = setTimeout(fetchPreviewCount, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isImportModalOpen, importFolderIds, importCaseType, importPriorities, importLabels]);

  // Robust WebSocket connection with exponential backoff
  useEffect(() => {
    if (!activeCycleId) return;

    let isSubscribed = true;

    const connectWS = () => {
      if (wsRef.current) wsRef.current.close();
      const ws = new WebSocket(`${WS_BASE}/qa_cycle/${activeCycleId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectTimeout.current = 1000; // Reset backoff on successful connect
        setWsConnected(true); // Connection re-established
      };

      ws.onmessage = (event) => {
        if (!isSubscribed) return;
        const message = JSON.parse(event.data);
        if (message.type === 'item_update') {
          setCycles(prev => prev.map(c => {
            if (c.id !== activeCycleId) return c;
            return {
              ...c,
              items: c.items.map(i => i.id === message.data.id ? { ...i, ...message.data } : i)
            };
          }));
        }
      };

      ws.onclose = (e) => {
        if (!isSubscribed || e.code === 1000) { // 1000 is normal closure
          setWsConnected(true); // Ensure connected state if closed normally
          return;
        }
        setWsConnected(false); // Connection lost
        // Exponential backoff reconnect
        setTimeout(() => {
          if (isSubscribed) connectWS();
        }, reconnectTimeout.current);
        reconnectTimeout.current = Math.min(reconnectTimeout.current * 1.5, 30000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setWsConnected(false); // Set disconnected on error
        ws.close(); // Attempt to close and trigger reconnect logic
      };
    };

    connectWS();

    return () => {
      isSubscribed = false;
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
        wsRef.current = null;
      }
    };
  }, [activeCycleId]);

  const activeCycle = useMemo(() => cycles.find(c => c.id === activeCycleId), [cycles, activeCycleId]);

  // Derived filtered items
  const filteredItems = useMemo(() => {
    if (!activeCycle) return [];
    return activeCycle.items.filter(item => {
      const matchF = activeFilter === 'all' || item.status === activeFilter;
      const matchQ = !searchQ || 
                     (item.checklist_label || '').toLowerCase().includes(searchQ.toLowerCase()) || 
                     (item.test_case?.name || '').toLowerCase().includes(searchQ.toLowerCase()) || 
                     (item.test_case?.zephyr_key || '').toLowerCase().includes(searchQ.toLowerCase()) ||
                     (item.bug_id || '').toLowerCase().includes(searchQ.toLowerCase());
      const matchM = activeModuleFilter === 'all' || (item.module || '').toLowerCase() === activeModuleFilter.toLowerCase(); // New module filter
      
      let matchT = true;
      if (activeTagFilter !== 'all') {
        const name = (item.test_case?.name || '').toLowerCase();
        const folder = (item.test_case?.folder_path || '').toLowerCase();
        const label = (item.checklist_label || '').toLowerCase();
        if (activeTagFilter === 'sanity') {
          matchT = name.includes('sanity') || folder.includes('sanity') || label.includes('sanity');
        } else if (activeTagFilter === 'regression') {
          matchT = name.includes('regression') || folder.includes('regression') || label.includes('regression');
        }
      }

      return matchF && matchQ && matchM && matchT;
    });
  }, [activeCycle, activeFilter, searchQ, activeModuleFilter, activeTagFilter]);


  const handleImport = async () => {
    if (importFolderIds.length === 0 || !importCycleName) return setImportError('Please select at least one folder and provide a Cycle Name');
    setImporting(true);
    setImportError(null);
    try {
      const selectedPlatforms = Object.keys(importPlatforms).filter(k => importPlatforms[k]);
      const selectedPriorities = Object.keys(importPriorities).filter(k => importPriorities[k]);
      const selectedLabels = Object.keys(importLabels).filter(k => importLabels[k]);

      const queryParams = [
        `cycle_name=${encodeURIComponent(importCycleName)}`,
        ...importFolderIds.map(id => `folder_id=${id}`),
        `release_cycle=${encodeURIComponent(importReleaseCycle)}`,
        `version=${encodeURIComponent(importVersion)}`,
        `squad=${encodeURIComponent(importSquad)}`,
        `case_type=${importCaseType}`,
        ...selectedPlatforms.map(plat => `platforms=${encodeURIComponent(plat)}`),
        ...selectedPriorities.map(p => `priorities=${encodeURIComponent(p)}`),
        ...selectedLabels.map(lbl => `labels=${encodeURIComponent(lbl)}`)
      ].join('&');

      await apiFetch(`/cycles/import_from_zephyr?${queryParams}`, { method: 'POST' });
      setIsImportModalOpen(false);
      
      // Reset inputs
      setImportFolderIds([]);
      setImportCycleName('');
      setImportReleaseCycle('');
      setImportVersion('');
      setImportSquad('');
      setImportPlatforms({ Mobile: false, Web: false, API: false });
      setImportCaseType('all');
      setImportPriorities({ High: true, Normal: true, Low: true });
      setImportLabels({ sanity: false, regression: false });
      setIsCycleNameTouched(false);

      fetchData();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const updateItem = async (itemId, updates) => {
    if (activeCycle?.is_locked && !isAdmin) {
      alert('This cycle is locked and cannot be modified.');
      return;
    }

    const currentItem = activeCycle.items.find(i => i.id === itemId);
    const oldStatus = currentItem?.status;

    try {
      // Optimistic update for snappy UI
      setCycles(prev => prev.map(c => {
        if (c.id !== activeCycleId) return c;
        return {
          ...c,
          items: c.items.map(i => i.id === itemId ? { ...i, ...updates } : i)
        };
      }));

      await apiFetch(`/cycles/${activeCycleId}/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
      });

      // Trigger flash animation if status changed from pending to pass
      if (oldStatus === 'pending' && updates.status === 'pass') {
        setItemToFlashId(itemId);
        setTimeout(() => setItemToFlashId(null), 300); // Remove flash class after animation
      }

      // Dependency Cascade Logic: If status changes to 'blocked'
      if (updates.status === 'blocked' && oldStatus !== 'blocked' && activeCycle) {
        const childItems = activeCycle.items.filter(item => item.parent_id === itemId);
        if (childItems.length > 0) {
          setItemToCascade({ parentItem: currentItem, childItems: childItems });
          setShowCascadeModal(true);
        }
      }

    } catch (err) {
      console.error('Failed to update item:', err);
      // Revert on failure (fetch fresh data)
      fetchData(); 
    }
  };

  const handleCascadeConfirm = async (parentItem, cascadeStatus) => {
    if (!parentItem || !parentItem.childItems || parentItem.childItems.length === 0) return;

    const itemsToUpdate = parentItem.childItems.map(child => child.id);
    
    // Optimistic update for cascade
    setCycles(prev => prev.map(c => {
      if (c.id !== activeCycleId) return c;
      return {
        ...c,
        items: c.items.map(i => itemsToUpdate.includes(i.id) ? { ...i, status: cascadeStatus } : i)
      };
    }));

    // Perform updates sequentially
    for (const itemId of itemsToUpdate) {
      try {
        await apiFetch(`/cycles/${activeCycleId}/items/${itemId}`, {
          method: 'PUT',
          body: JSON.stringify({ status: cascadeStatus })
        });
      } catch (err) {
        console.error('Failed to update cascaded item:', err);
        // Revert on failure (fetch fresh data)
        fetchData(); 
      }
    }
    setShowCascadeModal(false);
    setItemToCascade(null);
  };

  const handleCascadeCancel = () => {
    setShowCascadeModal(false);
    setItemToCascade(null);
  };


  const updateBulkItems = async (updates) => { // Modified to accept general updates
    if (activeCycle?.is_locked && !isAdmin) {
      alert('This cycle is locked and cannot be modified.');
      return;
    }
    if (selectedItems.size === 0) return;
    const itemsToUpdate = Array.from(selectedItems);
    
    // Optimistic update
    setCycles(prev => prev.map(c => {
      if (c.id !== activeCycleId) return c;
      return {
        ...c,
        items: c.items.map(i => itemsToUpdate.includes(i.id) ? { ...i, ...updates } : i)
      };
    }));

    // Perform updates sequentially (or could be refactored to a bulk backend endpoint later)
    for (const itemId of itemsToUpdate) {
      try {
        await apiFetch(`/cycles/${activeCycleId}/items/${itemId}`, {
          method: 'PUT',
          body: JSON.stringify(updates)
        });
      } catch (err) {
        console.error('Failed to update item bulk:', err);
      }
    }
    setSelectedItems(new Set());
    setBulkDropOpen(false);
  };

  const handleReopenCycle = async (justification) => {
    if (!activeCycle) return;
    try {
      // Simulate API call to reopen cycle
      console.log(`Reopening cycle ${activeCycle.name} with justification: ${justification}`);
      // In a real app, this would be an API call:
      // await apiFetch(`/cycles/${activeCycle.id}/reopen`, { method: 'POST', body: JSON.stringify({ justification }) });
      
      setCycles(prev => prev.map(c => 
        c.id === activeCycle.id ? { ...c, status: 'Active', is_locked: false, audit_log: [...(c.audit_log || []), { action: 'Reopened', timestamp: new Date().toISOString(), justification }] } : c
      ));
      setShowReopenCycleModal(false);
      alert(`Cycle '${activeCycle.name}' has been reopened.`);
    } catch (error) {
      console.error('Failed to reopen cycle:', error);
      alert('Failed to reopen cycle. Please try again.');
    }
  };


  const toggleExpand = (id) => {
    // No longer used for inline expansion, but keeping for potential future use or if other components use it
    // const next = new Set(expanded);
    // if (next.has(id)) next.delete(id);
    // else next.add(id);
    // setExpanded(next);
  };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    const next = new Set(selectedItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedItems(next);
  };

  const toggleSelectAll = (e) => {
    if (selectedItems.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.id)));
    }
  };

  const closeDropdowns = useCallback(() => {
    setDropK(null);
    setBulkDropOpen(false);
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

  const getStats = (cycle) => {
    const s = { pass: 0, fail: 0, hold: 0, blocked: 0, skip: 0, na: 0, pending: 0, pass_flaky: 0, total: 0 };
    if (!cycle || !cycle.items) return s;
    cycle.items.forEach(item => {
      s[item.status] = (s[item.status] || 0) + 1;
      s.total++;
    });
    return s;
  };

  const stats = getStats(activeCycle);
  const pctPass = stats.total === 0 ? 0 : Math.round((stats.pass / stats.total) * 100);

  // Calculate additional KPIs
  const totalBlockers = stats.blocked;
  const flakyTestCount = stats.pass_flaky;

  const dueTodayCount = useMemo(() => {
    if (!cycles || cycles.length === 0) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    return cycles.filter(cycle => {
      if (!cycle.deadline) return false;
      const deadlineDate = new Date(cycle.deadline);
      deadlineDate.setHours(0, 0, 0, 0);
      return deadlineDate.getTime() === today.getTime();
    }).length;
  }, [cycles]);

  // Calculate overall completion for the active cycle
  const overallCompletionPct = useMemo(() => {
    if (!activeCycle || !activeCycle.items || activeCycle.items.length === 0) return 0;
    const completedItems = activeCycle.items.filter(item => item.status === 'pass' || item.status === 'pass_flaky' || item.status === 'fail' || item.status === 'blocked' || item.status === 'skip' || item.status === 'na').length;
    return Math.round((completedItems / activeCycle.items.length) * 100);
  }, [activeCycle]);


  if (loading) return (
    <div className="qa-portal-container">
      <Sidebar
        cycles={[]} // Pass empty cycles to sidebar during loading
        activeSelection={null}
        setActiveSelection={() => {}}
        setIsImportModalOpen={() => {}}
        activeCycle={null} // Pass null activeCycle during loading
        overallCompletionPct={0} // Pass 0 completion during loading
        activeModuleFilter={activeModuleFilter} // Pass to sidebar
        setActiveModuleFilter={setActiveModuleFilter} // Pass to sidebar
        isAdmin={isAdmin}
        setShowReopenCycleModal={setShowReopenCycleModal}
      />
      <TableSkeletonLoader />
    </div>
  );

  return (
    <div className="qa-portal-container">
      {!wsConnected && (
        <div className="qa-connection-error-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <XCircle size={20} color="var(--danger)" />
            <span>Jira connection lost. Attempting to reconnect...</span>
          </div>
          <button onClick={() => setWsConnected(true)} className="qa-connection-error-dismiss">
            <XCircle size={16} />
          </button>
        </div>
      )}
      <Sidebar 
        cycles={cycles} 
        activeSelection={activeSelection} 
        setActiveSelection={setActiveSelection} 
        setIsImportModalOpen={setIsImportModalOpen} 
        activeCycle={activeCycle} // Pass activeCycle to Sidebar
        overallCompletionPct={overallCompletionPct} // Pass overallCompletionPct to Sidebar
        activeModuleFilter={activeModuleFilter} // Pass to sidebar
        setActiveModuleFilter={setActiveModuleFilter} // Pass to sidebar
        isAdmin={isAdmin} // Pass isAdmin to Sidebar
        setShowReopenCycleModal={setShowReopenCycleModal} // Pass setter to Sidebar
      />
      <MainContent
        activeCycle={activeCycle}
        pctPass={pctPass}
        setIsReportOpen={setIsReportOpen}
        searchQ={searchQ}
        setSearchQ={setSearchQ}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        setSelectedItems={setSelectedItems}
        stats={stats}
        selectedItems={selectedItems}
        setBulkDropOpen={setBulkDropOpen}
        bulkDropOpen={bulkDropOpen}
        setDropK={setDropK}
        dropK={dropK}
        updateBulkItems={updateBulkItems}
        toggleSelectAll={toggleSelectAll}
        filteredItems={filteredItems}
        toggleExpand={toggleExpand}
        expanded={expanded}
        toggleSelect={toggleSelect}
        updateItem={updateItem}
        setIsImportModalOpen={setIsImportModalOpen}
        itemToFlashId={itemToFlashId} // Pass new state
        totalBlockers={totalBlockers} // New KPI
        dueTodayCount={dueTodayCount} // New KPI
        flakyTestCount={flakyTestCount} // New KPI
        activeModuleFilter={activeModuleFilter} // Pass to MainContent
        availableTesters={availableTesters} // Pass available testers
        isCycleLocked={activeCycle?.is_locked} // Pass lock status to MainContent
        activeTagFilter={activeTagFilter} // Pass tag filter to MainContent
        setActiveTagFilter={setActiveTagFilter} // Pass tag filter setter to MainContent
        activeSelection={activeSelection}
        setActiveSelection={setActiveSelection}
        cycles={cycles}
      />

      {showCascadeModal && itemToCascade && (
        <ConfirmationModal
          title="Cascade Status Change?"
          message={`The status of "${itemToCascade.parentItem.test_case?.name}" was changed to BLOCKED. Do you want to cascade this status to its ${itemToCascade.childItems.length} linked child items?`}
          confirmOptions={[
            { label: 'Mark children as BLOCKED', value: 'blocked', color: 'var(--danger)' },
            { label: 'Mark children as N/A', value: 'na', color: 'var(--neutral)' }
          ]}
          onConfirm={(cascadeStatus) => handleCascadeConfirm(itemToCascade, cascadeStatus)}
          onCancel={handleCascadeCancel}
        />
      )}

      {showReopenCycleModal && activeCycle && (
        <ReopenCycleModal
          cycleName={activeCycle.name}
          onConfirm={handleReopenCycle}
          onCancel={() => setShowReopenCycleModal(false)}
        />
      )}

      {isImportModalOpen && (
        <div className="qa-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setIsImportModalOpen(false); }}>
          <div className="qa-modal-content thin-scrollbar" style={{ maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>New Release Cycle</h2>
              <button onClick={() => setIsImportModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <XCircle size={20} />
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Hierarchical Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Release Cycle</label>
                  <input
                    type="text"
                    placeholder="e.g. Release June"
                    value={importReleaseCycle}
                    onChange={(e) => handleReleaseCycleChange(e.target.value)}
                    className="qa-search-input"
                    style={{ paddingLeft: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Version</label>
                  <input
                    type="text"
                    placeholder="e.g. v1.4.0"
                    value={importVersion}
                    onChange={(e) => handleVersionChange(e.target.value)}
                    className="qa-search-input"
                    style={{ paddingLeft: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Squad</label>
                  <select
                    value={importSquad}
                    onChange={(e) => handleSquadChange(e.target.value)}
                    className="qa-search-input"
                    style={{ paddingLeft: 12, appearance: 'none', cursor: 'pointer', backgroundImage: 'url("data:image/svg+xml;utf8,<svg fill=\'%2364748b\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/></svg>")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                  >
                    <option value="" disabled>Select Squad</option>
                    <option value="Futures">Futures</option>
                    <option value="Spot">Spot</option>
                    <option value="Payments">Payments</option>
                    <option value="Options">Options</option>
                    <option value="Engagement">Engagement</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Cycle Name (Zephyr Output)</label>
                <input
                  type="text"
                  placeholder="Release / Version / Squad"
                  value={importCycleName}
                  onChange={(e) => {
                    setImportCycleName(e.target.value);
                    setIsCycleNameTouched(true);
                  }}
                  className="qa-search-input"
                  style={{ paddingLeft: 12 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Import Test Cases From Folder</label>
                <FolderSelect
                  folders={folders}
                  value={importFolderIds}
                  onChange={setImportFolderIds}
                />
              </div>

              {/* Platforms Scope */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Platforms Checkpoints</label>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {['Mobile', 'Web', 'API'].map(plat => (
                    <label key={plat} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={importPlatforms[plat]}
                        onChange={(e) => setImportPlatforms(prev => ({ ...prev, [plat]: e.target.checked }))}
                        style={{ accentColor: 'var(--brand-accent)' }}
                      />
                      {plat}
                    </label>
                  ))}
                </div>
              </div>

              {/* Case Type Segment Control */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Case Type</label>
                <div className="qa-filter-group" style={{ display: 'flex', width: 'fit-content' }}>
                  {[
                    { label: 'All Cases', value: 'all' },
                    { label: 'Manual Only', value: 'manual' },
                    { label: 'Automated Only', value: 'automated' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`qa-filter-btn ${importCaseType === opt.value ? 'active' : ''}`}
                      onClick={() => setImportCaseType(opt.value)}
                      style={{ padding: '6px 12px' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priorities Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Priorities</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {['High', 'Normal', 'Low'].map(p => (
                    <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={importPriorities[p]}
                        onChange={(e) => setImportPriorities(prev => ({ ...prev, [p]: e.target.checked }))}
                        style={{ accentColor: 'var(--brand-accent)' }}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>

              {/* Sanity & Regression Labels checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Labels / Tags</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {['sanity', 'regression'].map(lbl => (
                    <label key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer', textTransform: 'capitalize' }}>
                      <input
                        type="checkbox"
                        checked={importLabels[lbl]}
                        onChange={(e) => setImportLabels(prev => ({ ...prev, [lbl]: e.target.checked }))}
                        style={{ accentColor: 'var(--brand-accent)' }}
                      />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>

              <div className="qa-import-summary" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px', backgroundColor: 'var(--brand-accent-dim)', borderRadius: '12px', border: '1px solid rgba(96, 165, 250, 0.2)', marginTop: '8px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(96, 165, 250, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-accent)' }}>
                  <ListChecks size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Import Summary</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {loadingPreviewCount ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="qa-spinner" style={{ width: 12, height: 12, border: '2px solid var(--brand-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                        Calculating cases...
                      </span>
                    ) : (
                      previewCount !== null ? (
                        <span>Approximately <strong style={{ color: 'var(--brand-accent)' }}>{previewCount} test cases</strong> match your criteria and will be imported.</span>
                      ) : (
                        <span>Adjust filters to calculate test cases.</span>
                      )
                    )}
                  </span>
                </div>
              </div>

              {importError && (
                <div style={{ color: 'var(--danger)', fontSize: 13, backgroundColor: 'var(--danger-dim)', padding: 12, borderRadius: 8, border: '1px solid var(--danger)', marginTop: 8 }}>
                  {importError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="qa-btn-secondary"
                  style={{ flex: 1, padding: '10px 0' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing}
                  className="qa-btn-primary"
                  style={{ flex: 1, padding: '10px 0', justifyContent: 'center' }}
                >
                  {importing ? 'Importing...' : 'Create Cycle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isReportOpen && (
        <div className="qa-modal-overlay" onClick={() => setIsReportOpen(false)} style={{ zIndex: 90 }} />
      )}
      {isReportOpen && (
        <ReportPanel 
          activeCycle={activeCycle}
          activeSelection={activeSelection}
          cycles={cycles}
          onClose={() => setIsReportOpen(false)} 
        />
      )}
    </div>
  );
};

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
};const ReportPanel = ({ activeCycle, activeSelection, cycles = [], onClose }) => {
  const [sortBy, setSortBy] = useState('squad'); // 'squad', 'passPct', 'progressPct'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'
  const [expandedIssues, setExpandedIssues] = useState(new Set());

  const siblingCycles = useMemo(() => {
    if (!cycles || !activeSelection) return [];
    
    const normalizeVerName = (v) => v ? (v.toLowerCase().startsWith('v') ? v : `v${v}`) : "v1.0.0";
    
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
    } else if (activeSelection.type === 'squad') {
      if (activeCycle) {
        const parts = getParsedParts(activeCycle);
        return cycles.filter(c => {
          const cParts = getParsedParts(c);
          return cParts.rc === parts.rc && cParts.ver === parts.ver;
        });
      }
    }
    return [];
  }, [activeSelection, activeCycle, cycles]);

  const reportContextName = useMemo(() => {
    if (activeSelection?.type === 'release') return { rc: activeSelection.name, ver: 'All Versions' };
    if (activeSelection?.type === 'version') return { rc: activeSelection.rcName, ver: activeSelection.verName };
    if (activeSelection?.type === 'squad' && activeCycle) {
      const rc = activeCycle.release_cycle || activeCycle.name.split('/')[0]?.trim();
      const ver = activeCycle.version || activeCycle.name.split('/')[1]?.trim();
      return { rc: rc || 'General', ver: ver || 'v1.0.0' };
    }
    return { rc: 'General', ver: 'v1.0.0' };
  }, [activeSelection, activeCycle]);

  const aggregatedStats = useMemo(() => {
    const s = { pass: 0, fail: 0, hold: 0, blocked: 0, skip: 0, na: 0, pending: 0, pass_flaky: 0, total: 0 };
    siblingCycles.forEach(c => {
      if (!c.items) return;
      c.items.forEach(item => {
        const status = item.status || 'pending';
        s[status] = (s[status] || 0) + 1;
        s.total++;
      });
    });
    return s;
  }, [siblingCycles]);

  const aggregatedPctPass = useMemo(() => {
    if (aggregatedStats.total === 0) return 0;
    return Math.round((aggregatedStats.pass / aggregatedStats.total) * 100);
  }, [aggregatedStats]);

  const squadBreakdown = useMemo(() => {
    return siblingCycles.map(c => {
      const s = { pass: 0, fail: 0, hold: 0, blocked: 0, skip: 0, na: 0, pending: 0, pass_flaky: 0, total: 0 };
      if (c.items) {
        c.items.forEach(item => {
          const status = item.status || 'pending';
          s[status] = (s[status] || 0) + 1;
          s.total++;
        });
      }
      const completed = s.total - s.pending;
      const progressPct = s.total === 0 ? 0 : Math.round((completed / s.total) * 100);
      const passPct = s.total === 0 ? 0 : Math.round((s.pass / s.total) * 100);
      return {
        id: c.id,
        squad: c.squad || 'Unknown',
        owner: c.owner || 'Unassigned',
        build_version: c.build_version || '—',
        total: s.total,
        completed,
        progressPct,
        passPct,
        fail: s.fail,
        blocked: s.blocked
      };
    });
  }, [siblingCycles]);

  const sortedSquadBreakdown = useMemo(() => {
    return [...squadBreakdown].sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      
      if (typeof valA === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }
    });
  }, [squadBreakdown, sortBy, sortOrder]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder(field === 'squad' ? 'asc' : 'desc');
    }
  };

  const platformBreakdown = useMemo(() => {
    const groups = {};
    siblingCycles.forEach(c => {
      if (!c.items) return;
      c.items.forEach(item => {
        const plat = item.platform || 'General';
        const status = item.status || 'pending';
        if (!groups[plat]) {
          groups[plat] = { platform: plat, total: 0, pass: 0, fail: 0, blocked: 0, other: 0, pending: 0 };
        }
        groups[plat].total++;
        if (status === 'pending') {
          groups[plat].pending++;
        } else if (status === 'pass' || status === 'pass_flaky') {
          groups[plat].pass++;
        } else if (status === 'fail') {
          groups[plat].fail++;
        } else if (status === 'blocked') {
          groups[plat].blocked++;
        } else {
          groups[plat].other++;
        }
      });
    });
    
    return Object.values(groups).map(g => {
      const executed = g.total - g.pending;
      const completionPct = g.total === 0 ? 0 : Math.round((executed / g.total) * 100);
      const passPct = g.total === 0 ? 0 : Math.round((g.pass / g.total) * 100);
      return { ...g, completionPct, passPct };
    });
  }, [siblingCycles]);

  const issues = useMemo(() => {
    const list = [];
    siblingCycles.forEach(c => {
      if (!c.items) return;
      c.items.forEach(item => {
        if (item.status === 'fail' || item.status === 'blocked') {
          list.push({ ...item, squad: c.squad });
        }
      });
    });
    return list;
  }, [siblingCycles]);

  const toggleIssueExpand = (id) => {
    setExpandedIssues(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tone = getStatusTone(aggregatedPctPass);
  const executedPct = aggregatedStats.total === 0 ? 0 : Math.round(((aggregatedStats.total - aggregatedStats.pending) / aggregatedStats.total) * 100);
  const totalIssuesCount = aggregatedStats.fail + aggregatedStats.blocked;

  return (
    <div className="qa-report-panel glassmorphic-panel">
      {/* Header */}
      <div className="qa-report-header">
        <div>
          <h2 className="qa-report-title">Release Quality Report</h2>
          <div className="qa-report-subtitle">
            {reportContextName.rc} — {reportContextName.ver}
          </div>
        </div>
        <button onClick={onClose} className="qa-report-close-btn" aria-label="Close report">
          <XCircle size={22} />
        </button>
      </div>

      {/* Body */}
      <div className="qa-report-body thin-scrollbar">
        
        {/* Top KPI Cards Grid */}
        <div className="qa-report-kpi-grid">
          <div className="qa-report-kpi-card" style={{ '--card-glow': tone.color }}>
            <div className="qa-report-kpi-icon-wrapper" style={{ backgroundColor: tone.bg, color: tone.color }}>
              <TrendingUp size={20} />
            </div>
            <div className="qa-report-kpi-details">
              <span className="qa-report-kpi-label">Pass Rate</span>
              <span className="qa-report-kpi-value" style={{ color: tone.color }}>{aggregatedPctPass}%</span>
            </div>
          </div>

          <div className="qa-report-kpi-card" style={{ '--card-glow': 'var(--blue)' }}>
            <div className="qa-report-kpi-icon-wrapper" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--blue)' }}>
              <Activity size={20} />
            </div>
            <div className="qa-report-kpi-details">
              <span className="qa-report-kpi-label">Executed</span>
              <span className="qa-report-kpi-value">{executedPct}%</span>
              <span className="qa-report-kpi-subtext">{aggregatedStats.total - aggregatedStats.pending} / {aggregatedStats.total} cases</span>
            </div>
          </div>

          <div className="qa-report-kpi-card" style={{ '--card-glow': totalIssuesCount > 0 ? 'var(--red)' : 'var(--green)' }}>
            <div className="qa-report-kpi-icon-wrapper" style={{ 
              backgroundColor: totalIssuesCount > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
              color: totalIssuesCount > 0 ? 'var(--red)' : 'var(--green)' 
            }}>
              <AlertTriangle size={20} />
            </div>
            <div className="qa-report-kpi-details">
              <span className="qa-report-kpi-label">Risk Blockers</span>
              <span className="qa-report-kpi-value" style={{ color: totalIssuesCount > 0 ? 'var(--red)' : 'var(--green)' }}>
                {totalIssuesCount}
              </span>
              <span className="qa-report-kpi-subtext">{aggregatedStats.fail} Fails • {aggregatedStats.blocked} Blocked</span>
            </div>
          </div>
        </div>

        {/* Status Breakdown Section */}
        <div className="qa-report-section">
          <h3 className="qa-report-section-title">Status Breakdown (All Squads)</h3>
          <div className="qa-report-status-grid">
            <div className="qa-report-status-item success">
              <span className="label">Pass</span>
              <span className="val">{aggregatedStats.pass}</span>
            </div>
            <div className="qa-report-status-item warning">
              <span className="label">Flaky Pass</span>
              <span className="val">{aggregatedStats.pass_flaky}</span>
            </div>
            <div className="qa-report-status-item danger">
              <span className="label">Fail</span>
              <span className="val">{aggregatedStats.fail}</span>
            </div>
            <div className="qa-report-status-item blocker">
              <span className="label">Blocked</span>
              <span className="val">{aggregatedStats.blocked}</span>
            </div>
            <div className="qa-report-status-item skip">
              <span className="label">Skip / NA</span>
              <span className="val">{aggregatedStats.skip + aggregatedStats.na}</span>
            </div>
            <div className="qa-report-status-item pending">
              <span className="label">Pending</span>
              <span className="val">{aggregatedStats.pending}</span>
            </div>
          </div>
        </div>

        {/* Sibling Squad Breakdown List */}
        <div className="qa-report-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 className="qa-report-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Squad Performance</h3>
            
            {/* Sort controls */}
            <div className="qa-report-sort-controls">
              <span className="qa-report-sort-label">Sort by:</span>
              <button 
                className={`qa-report-sort-btn ${sortBy === 'squad' ? 'active' : ''}`}
                onClick={() => handleSort('squad')}
              >
                Squad {sortBy === 'squad' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`qa-report-sort-btn ${sortBy === 'passPct' ? 'active' : ''}`}
                onClick={() => handleSort('passPct')}
              >
                Pass {sortBy === 'passPct' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`qa-report-sort-btn ${sortBy === 'progressPct' ? 'active' : ''}`}
                onClick={() => handleSort('progressPct')}
              >
                Progress {sortBy === 'progressPct' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
            </div>
          </div>

          {sortedSquadBreakdown.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No squad execution data found.</div>
          ) : (
            <div className="qa-report-squad-list">
              {sortedSquadBreakdown.map(sb => {
                const isCurrent = sb.id === activeCycle?.id;
                const squadTone = getStatusTone(sb.passPct);
                return (
                  <div key={sb.id} className={`qa-report-squad-card ${isCurrent ? 'current' : ''}`}>
                    <div className="qa-report-squad-row">
                      <div className="qa-report-squad-info">
                        <span className="qa-report-squad-name">
                          {sb.squad}
                          {isCurrent && <span className="qa-report-active-badge">Active</span>}
                        </span>
                        <span className="qa-report-squad-owner">{sb.owner} • Build: {sb.build_version}</span>
                      </div>
                      <div className="qa-report-squad-metrics">
                        <div className="qa-report-squad-metric">
                          <span className="metric-label">Progress</span>
                          <span className="metric-val">{sb.progressPct}%</span>
                        </div>
                        <div className="qa-report-squad-metric">
                          <span className="metric-label">Pass Rate</span>
                          <span className="metric-val" style={{ color: squadTone.color }}>{sb.passPct}%</span>
                        </div>
                        {(sb.fail > 0 || sb.blocked > 0) && (
                          <div className="qa-report-squad-issues">
                            {sb.fail > 0 && <span className="squad-issue-pill fail">{sb.fail}F</span>}
                            {sb.blocked > 0 && <span className="squad-issue-pill blocked">{sb.blocked}B</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress meter */}
                    <div className="qa-report-bar-bg" style={{ height: 4, marginTop: 8 }}>
                      <div 
                        className="qa-report-bar-fill" 
                        style={{ 
                          width: `${sb.progressPct}%`, 
                          backgroundColor: 'var(--blue)' 
                        }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Platform Performance Section */}
        <div className="qa-report-section">
          <h3 className="qa-report-section-title">Platform Performance</h3>
          {platformBreakdown.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No platform execution data found.</div>
          ) : (
            <div className="qa-report-platform-list">
              {platformBreakdown.map(pb => {
                const pbTone = getStatusTone(pb.passPct);
                return (
                  <div key={pb.platform} className="qa-report-platform-row">
                    <div className="qa-report-platform-info">
                      <span className="qa-report-platform-name">{pb.platform}</span>
                      <span className="qa-report-platform-exec">{pb.total - pb.pending} / {pb.total} executed</span>
                    </div>
                    <div className="qa-report-platform-bar-wrapper">
                      <div className="qa-report-bar-bg" style={{ height: 4, width: 120 }}>
                        <div className="qa-report-bar-fill" style={{ width: `${pb.completionPct}%`, backgroundColor: 'var(--blue)' }} />
                      </div>
                      <span className="qa-report-platform-pass" style={{ color: pbTone.color }}>{pb.passPct}% Pass</span>
                    </div>
                    <div className="qa-report-platform-issues">
                      {pb.fail > 0 && <span className="squad-issue-pill fail">{pb.fail}F</span>}
                      {pb.blocked > 0 && <span className="squad-issue-pill blocked">{pb.blocked}B</span>}
                      {pb.fail === 0 && pb.blocked === 0 && <span className="squad-issue-pill success">Clean</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Failures and Blockers list */}
        <div className="qa-report-section">
          <h3 className="qa-report-section-title">Active Failures & Blockers ({issues.length})</h3>
          {issues.length === 0 ? (
            <div className="qa-report-empty-state">
              🎉 No failure or blocker issues found! Looking solid.
            </div>
          ) : (
            <div className="qa-report-issue-list">
              {issues.map(item => {
                const isExpanded = expandedIssues.has(item.id);
                return (
                  <div key={item.id} className="qa-report-issue-card">
                    <div 
                      className="qa-report-issue-header"
                      onClick={() => toggleIssueExpand(item.id)}
                      style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: 'var(--blue)', backgroundColor: 'var(--brand-accent-dim)', padding: '2px 6px', borderRadius: 4 }}>
                          {item.test_case?.zephyr_key}
                        </span>
                        <span className={`qa-report-issue-badge ${item.status}`}>
                          {item.status.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                        <span style={{ fontSize: 11 }}>{item.squad}</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </div>
                    
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 8 }}>
                      {item.checklist_label || item.test_case?.name}
                    </div>

                    {isExpanded && (
                      <div className="qa-report-issue-expanded" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Assignee: <strong style={{ color: 'var(--text-primary)' }}>{item.assigned_to || 'Unassigned'}</strong></span>
                          <span>Platform: <strong style={{ color: 'var(--text-primary)' }}>{item.platform || 'N/A'}</strong></span>
                        </div>
                        {item.bug_id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>Bug Ticket:</span>
                            <JiraStatus issueKey={item.bug_id} />
                          </div>
                        ) : (
                          <span style={{ color: 'var(--warning)', fontWeight: 500 }}>⚠️ No Bug Ticket Linked</span>
                        )}
                        {item.notes && (
                          <div style={{ marginTop: 4, padding: 8, borderRadius: 6, backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
                            <strong style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 2 }}>Notes</strong>
                            {item.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QAChecklistPage;