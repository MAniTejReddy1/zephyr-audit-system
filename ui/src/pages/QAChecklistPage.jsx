import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../utils';
import Sidebar from '../components/qa/Sidebar';
import MainContent from '../components/qa/MainContent';
import { STATUS_ICONS, STATUS_COLORS, STATUS_LABELS } from '../constants.jsx';
import './QAChecklistPage.css';
import { XCircle } from 'lucide-react'; // Import XCircle for the dismiss button
import TableSkeletonLoader from '../components/qa/TableSkeletonLoader.jsx'; // Import the new skeleton loader
import ConfirmationModal from '../components/qa/ConfirmationModal.jsx'; // Import new modal component
import ReopenCycleModal from '../components/qa/ReopenCycleModal.jsx'; // Import ReopenCycleModal

const WS_BASE = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000/ws';

const QAChecklistPage = () => {
  const [cycles, setCycles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeCycleId, setActiveCycleId] = useState(null);
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

  // Modal states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [importFolderId, setImportFolderId] = useState('');
  const [importCycleName, setImportCycleName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  // Dependency Cascade Modal State
  const [showCascadeModal, setShowCascadeModal] = useState(false);
  const [itemToCascade, setItemToCascade] = useState(null); // Stores the parent item that triggered the cascade

  // Reopen Cycle Modal State
  const [showReopenCycleModal, setShowReopenCycleModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true); // Placeholder for admin role check

  // WebSocket reconnect ref
  const wsRef = useRef(null);
  const reconnectTimeout = useRef(1000);

  // Static list of available testers
  const availableTesters = useMemo(() => [
    { id: 'tester1', name: 'Alice Smith' },
    { id: 'tester2', name: 'Bob Johnson' },
    { id: 'tester3', name: 'Charlie Brown' },
    { id: 'tester4', name: 'Diana Prince' },
  ], []);

  const fetchData = useCallback(async () => {
    try {
      const [cyclesData, foldersData] = await Promise.all([
        apiFetch('/cycles'),
        apiFetch('/folders?with_counts=true')
      ]);
      // Simulate adding status and is_locked for demonstration
      const processedCycles = cyclesData.map(cycle => ({
        ...cycle,
        status: cycle.status || 'Active', // Default status
        is_locked: cycle.status === 'Signed Off' // Locked if Signed Off
      }));
      setCycles(processedCycles);
      setFolders(foldersData);
      if (processedCycles.length > 0 && !activeCycleId) {
        setActiveCycleId(processedCycles[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      // Optionally set a general API error state here if needed
    } finally {
      setLoading(false);
    }
  }, [activeCycleId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
                     (item.test_case?.name || '').toLowerCase().includes(searchQ.toLowerCase()) || 
                     (item.test_case?.zephyr_key || '').toLowerCase().includes(searchQ.toLowerCase()) ||
                     (item.bug_id || '').toLowerCase().includes(searchQ.toLowerCase());
      const matchM = activeModuleFilter === 'all' || (item.test_case?.module || '').toLowerCase() === activeModuleFilter.toLowerCase(); // New module filter

      return matchF && matchQ && matchM;
    });
  }, [activeCycle, activeFilter, searchQ, activeModuleFilter]);

  const handleImport = async () => {
    if (!importFolderId || !importCycleName) return setImportError('Please select a folder and provide a Cycle Name');
    setImporting(true);
    setImportError(null);
    try {
      await apiFetch(`/cycles/import_from_zephyr?folder_id=${importFolderId}&cycle_name=${encodeURIComponent(importCycleName)}`, { method: 'POST' });
      setIsImportModalOpen(false);
      setImportFolderId('');
      setImportCycleName('');
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
    document.addEventListener('click', closeDropdowns);
    return () => document.removeEventListener('click', closeDropdowns);
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
        activeCycleId={null}
        setActiveCycleId={() => {}}
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
        activeCycleId={activeCycleId} 
        setActiveCycleId={setActiveCycleId} 
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
    </div>
  );
};

export default QAChecklistPage;