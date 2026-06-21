import React, { useMemo } from 'react';
import { ListChecks, Plus, Calendar, User, GitBranch, Layers, LockOpen } from 'lucide-react'; // Import LockOpen icon
import './Sidebar.css';

const CircularProgress = ({ percentage, size = 48, strokeWidth = 5 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        stroke="var(--border-light)"
        fill="transparent"
        strokeWidth={strokeWidth}
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
      <circle
        stroke="var(--brand-accent)"
        fill="transparent"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference + ' ' + circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        r={radius}
        cx={size / 2}
        cy={size / 2}
        style={{
          transition: 'stroke-dashoffset 0.5s ease-out',
          transform: 'rotate(-90deg)',
          transformOrigin: '50% 50%',
        }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="10px"
        fontWeight="700"
        fill="var(--text-primary)"
      >
        {percentage}%
      </text>
    </svg>
  );
};


const Sidebar = ({ cycles, activeCycleId, setActiveCycleId, setIsImportModalOpen, activeCycle, overallCompletionPct, activeModuleFilter, setActiveModuleFilter, isAdmin, setShowReopenCycleModal }) => {

  const deadlineInfo = useMemo(() => {
    if (!activeCycle || !activeCycle.deadline) return null;
    const deadlineDate = new Date(activeCycle.deadline);
    const now = new Date();
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: 'Overdue', color: 'var(--danger)' };
    } else if (diffDays <= 1) {
      return { text: 'Due Today', color: 'var(--danger)' };
    } else if (diffDays <= 7) {
      return { text: `${diffDays} days left`, color: 'var(--warning)' };
    } else {
      return { text: `${deadlineDate.toLocaleDateString()}`, color: 'var(--text-secondary)' };
    }
  }, [activeCycle]);

  const modules = useMemo(() => {
    if (!activeCycle || !activeCycle.items) return [];
    const uniqueModules = new Set(activeCycle.items.map(item => item.test_case?.module).filter(Boolean));
    return ['all', ...Array.from(uniqueModules).sort()];
  }, [activeCycle]);

  const isNewButtonDisabled = activeCycle?.is_locked;

  return (
    <div className="qa-sidebar">
      <div className="qa-sidebar-header">
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Release Cycles</h2>
        <button 
          onClick={() => setIsImportModalOpen(true)} 
          className="qa-btn-secondary" 
          style={{ padding: '6px 12px', fontSize: 12, display: 'flex', gap: 6 }}
          disabled={isNewButtonDisabled}
        >
          <Plus size={14} /> New
        </button>
      </div>
      
      <div className="qa-cycle-list">
        {activeCycle && (
          <>
            <div className="qa-release-summary-card">
              <div className="qa-release-summary-header">
                <h3 className="qa-release-summary-title">{activeCycle.name}</h3>
                <CircularProgress percentage={overallCompletionPct} />
              </div>
              <div className="qa-release-summary-meta">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                  <GitBranch size={14} /> {activeCycle.build_version || 'N/A'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                  <User size={14} /> {activeCycle.owner || 'N/A'}
                </span>
              </div>
              {deadlineInfo && (
                <div className="qa-release-summary-deadline" style={{ color: deadlineInfo.color }}>
                  <Calendar size={14} /> {deadlineInfo.text}
                </div>
              )}
              {activeCycle.is_locked && activeCycle.status === 'Signed Off' && isAdmin && (
                <button 
                  onClick={() => setShowReopenCycleModal(true)} 
                  className="qa-btn-secondary qa-reopen-btn"
                >
                  <LockOpen size={14} /> Reopen Cycle
                </button>
              )}
            </div>

            <div className="qa-module-filter-section">
              <div className="qa-module-filter-header">
                <Layers size={16} />
                <span>Modules</span>
              </div>
              <div className="qa-module-filter-list">
                {modules.map(moduleName => (
                  <button
                    key={moduleName}
                    className={`qa-module-filter-btn ${activeModuleFilter === moduleName ? 'active' : ''}`}
                    onClick={() => setActiveModuleFilter(moduleName)}
                  >
                    {moduleName === 'all' ? 'All Modules' : moduleName}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {cycles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <ListChecks size={40} color="var(--border)" style={{marginBottom: 16}}/>
            <div style={{color: 'var(--text-primary)', fontWeight: 600, marginBottom: 8}}>No Active Cycles</div>
            <div style={{color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5}}>Create a new checklist to track QA execution progress.</div>
          </div>
        ) : (
          cycles.map(cycle => {
            const isActive = cycle.id === activeCycleId;
            // Removed cStats and pct calculation as overallCompletionPct is passed for active cycle
            
            return (
              <div key={cycle.id} onClick={() => setActiveCycleId(cycle.id)} className={`qa-cycle-item ${isActive ? 'active' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: isActive ? 'var(--brand-accent)' : 'var(--text-primary)' }}>{cycle.name}</div>
                  {/* For inactive cycles, we can show a simple completion or total items */}
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', backgroundColor: 'var(--border-light)', padding: '2px 8px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                    {cycle.items ? `${cycle.items.filter(i => i.status !== 'pending').length}/${cycle.items.length}` : '0/0'}
                  </div>
                </div>
                {/* Simple progress bar for inactive cycles */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, height: 6, backgroundColor: 'var(--border-light)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${cycle.items ? Math.round(cycle.items.filter(i => i.status === 'pass').length / cycle.items.length * 100) : 0}%`, backgroundColor: 'var(--success)', transition: 'width 0.5s ease-out' }} />
                  </div>
                  <span style={{fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', width: 32, textAlign: 'right'}}>{cycle.items ? Math.round(cycle.items.filter(i => i.status === 'pass').length / cycle.items.length * 100) : 0}%</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Sidebar;