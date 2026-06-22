import React, { useState, useCallback, useEffect } from 'react';
import {
  History, Calendar, RefreshCw, Sun, Moon, ChevronRight, ChevronLeft,
  BarChart3, Users, Activity, Layers, Settings, ListChecks, TrendingUp,
  TrendingDown, Minus, AlertTriangle, Plus, Trash2, GitCommit, Move,
  ArrowRight, Info, Sparkles
} from 'lucide-react';

import { T, useTheme } from '../theme';
import { fmtDate, describeDelta, isUnknownActor, apiFetch } from '../utils';

export default function Sidebar({
  nav, onNav, stats, lastSync, onRefresh, collapsed, onToggleCollapse,
  lockCollapsed, isDark, onToggleTheme, onDrillAudit, onDrillTestcases,
  onDrillAutomated, onDrillManual, onDrillNone, statsPeriod, onPeriodChange
}) {
  const [syncing, setSyncing] = useState(false);
  const [isAutomationExpanded, setIsAutomationExpanded] = useState(true);
  const [isActivityExpanded, setIsActivityExpanded] = useState(true);
  const [isContributorsExpanded, setIsContributorsExpanded] = useState(true);
  const automation = stats.automation_coverage || {};
  const weeklyActivity = stats.weekly_activity || [];
  const contributors = stats.contributors_week || [];
  const weeklyWindow = stats.weekly_window || {};

  const autoCount = Number(automation.automated_cases || 0);
  const notAutoCount = Number(automation.not_automated_cases ?? automation.manual_cases ?? 0);
  const noneCount = Number(automation.none_cases || 0);
  const pieTotal = autoCount + notAutoCount + noneCount;
  const hasAutomationStats = pieTotal > 0;

  const periodLabel = weeklyWindow.label || 'This Period';

  const items = [
    { id: 'stream', icon: Activity, label: 'Audit Stream', color: T.blue, gradient: T.gradBlue },
    { id: 'testcases', icon: Layers, label: 'Test Cases', color: T.purple, gradient: T.gradPurple },
    { id: 'qa-checklist', icon: ListChecks, label: 'QA Checklist', color: T.green, gradient: T.gradGreen },
    { id: 'config', icon: Settings, label: 'Settings', color: T.orange, gradient: T.gradOrange },
  ];

  const handleSync = async () => {
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
    <aside style={{
      width: collapsed ? 64 : 280, background: T.sidebar, borderRight: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', transition: 'width .25s cubic-bezier(.4,0,.2,1)',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: collapsed ? '14px 0' : '15px 16px 13px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: T.gradBlue, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(96,165,250,.3)',
          }}>
            <History size={18} color="#fff"/>
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: '-.02em', lineHeight: 1.2 }}>Sentinel QA</div>
              <div style={{ fontSize: 10, color: T.teal, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: 6, background: T.teal, display: 'inline-block', animation: 'pulseDot 2s ease-in-out infinite' }}/>
                Live monitoring
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nav Items */}
      <nav style={{ padding: '6px 8px', flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
        {items.map(item => {
          const Icon = item.icon;
          const isActive = nav === item.id;
          return (
            <button
              key={item.id}
              className={`sb-nav-btn${isActive ? ' active' : ''}`}
              onClick={() => onNav(item.id)}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              style={{
                gap: 10, padding: collapsed ? '10px 0' : '8px 11px', borderRadius: 8, marginBottom: 2,
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: isActive ? item.gradient : 'transparent',
                color: isActive ? '#fff' : T.textMuted,
                boxShadow: isActive ? `0 3px 10px ${item.color}25` : 'none',
              }}
            >
              <Icon size={16}/>
              {!collapsed && <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Scrollable Analytics (expanded) */}
      {!collapsed && (
        <div className="sidebar-metrics" style={{ flex: 1, overflowY: 'auto', padding: '11px 11px 20px' }}>
          <CollapsibleSidebarSection
            icon={BarChart3}
            title="Automation Coverage"
            expanded={isAutomationExpanded}
            onToggle={() => setIsAutomationExpanded(!isAutomationExpanded)}
          />
          {isAutomationExpanded && (
            <InteractivePieChart
              automated={autoCount}
              notAutomated={notAutoCount}
              none={noneCount}
              total={pieTotal}
              onClickAutomated={onDrillAutomated}
              onClickNotAutomated={onDrillManual}
              onClickNone={onDrillNone}
              deltaAutomated={automation.automated_delta_count}
              baselineAt={automation.baseline_at}
              nav={nav}
            />
          )}

          <CollapsibleSidebarSection
            icon={Calendar}
            title={`Activity ${weeklyWindow.from_iso ? `· ${fmtDate(weeklyWindow.from_iso, 'short')}` : ''}`}
            expanded={isActivityExpanded}
            onToggle={() => setIsActivityExpanded(!isActivityExpanded)}
            marginTop={16}
          />
          {isActivityExpanded && (
            <>
              <PeriodSelector current={statsPeriod || '7d'} onChange={onPeriodChange}/>
              <WeeklyActivityCard rows={weeklyActivity} onDrillAudit={onDrillAudit}/>
            </>
          )}

          <CollapsibleSidebarSection
            icon={Users}
            title={`Contributors · ${periodLabel}`}
            expanded={isContributorsExpanded}
            onToggle={() => setIsContributorsExpanded(!isContributorsExpanded)}
            marginTop={16}
          />
          {isContributorsExpanded && (
            <ContributorsCard contributors={contributors}/>
          )}
        </div>
      )}

      {/* Collapsed Analytics */}
      {collapsed && (
        <div style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
          <CollapsedMetric icon={BarChart3} value={hasAutomationStats ? `${Math.round((autoCount / pieTotal) * 100)}%` : '--'} color={T.green} title="Automation coverage"/>
          <CollapsedMetric icon={Calendar} value={stats.changes_today ?? 0} color={T.orange} title="Changes today"/>
          <CollapsedMetric icon={Users} value={(contributors || []).length} color={T.blue} title="Contributors"/>
          <button
            onClick={handleSync}
            disabled={syncing}
            title="Sync & Refresh"
            aria-label="Sync and refresh"
            style={{
              width: 44, height: 36, borderRadius: 10, border: `1px solid ${T.border}`,
              background: T.card, color: syncing ? T.textDim : T.blue,
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4,
            }}
          >
            <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}/>
          </button>
        </div>
      )}

      {/* Sync Button (expanded) */}
      {!collapsed && (
        <div style={{ padding: '9px 10px 10px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 9, border: 'none',
              background: syncing ? T.card : T.gradBlue, color: syncing ? T.textMuted : '#fff',
              fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              boxShadow: syncing ? 'none' : '0 3px 12px rgba(96,165,250,.25)',
              opacity: syncing ? 0.7 : 1,
            }}
          >
            <RefreshCw size={12} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}/>
            {syncing ? 'Syncing…' : 'Sync & Refresh'}
          </button>
          {lastSync && (
            <div style={{ textAlign: 'center', marginTop: 5, fontSize: 8, color: T.textDim, letterSpacing: '.02em' }}>
              Synced {fmtDate(lastSync, 'time')}
            </div>
          )}
        </div>
      )}

      {/* Footer: Theme + Collapse */}
      <div style={{ borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
        <button
          onClick={onToggleTheme}
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          style={{
            flex: 1, padding: collapsed ? 13 : '10px 13px', background: 'transparent',
            border: 'none', color: T.textMuted, display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start', gap: 8,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
          onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; }}
        >
          {isDark ? <Sun size={15} color={T.yellow}/> : <Moon size={15} color={T.purple}/>}
          {!collapsed && <span style={{ fontSize: 11, fontWeight: 500 }}>{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
        {!lockCollapsed && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              padding: '0 13px', background: 'transparent', border: 'none',
              borderLeft: `1px solid ${T.border}`, color: T.textMuted,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; }}
          >
            {collapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}
          </button>
        )}
      </div>
    </aside>
  );
}

function SidebarSection({ icon: Icon, title, marginTop = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop, marginBottom: 7, padding: '0 1px' }}>
      <Icon size={10} color={T.textDim} style={{ flexShrink: 0 }}/>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: T.textDim, whiteSpace: 'nowrap' }}>{title}</span>
      <div style={{ flex: 1, height: '1px', background: T.borderLight, marginLeft: 3 }}/>
    </div>
  );
}

function CollapsibleSidebarSection({ icon: Icon, title, expanded, onToggle, marginTop = 0 }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginTop,
        marginBottom: 8,
        padding: '6px 1px',
        background: 'none',
        border: 'none',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        color: T.textDim,
        transition: 'color 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
      onMouseLeave={e => { e.currentTarget.style.color = T.textDim; }}
    >
      <Icon size={10} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', flex: 1 }}>
        {title}
      </span>
      <ChevronRight
        size={10}
        style={{
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          opacity: 0.7,
          flexShrink: 0
        }}
      />
    </button>
  );
}

function CollapsedMetric({ icon: Icon, value, color, title }) {
  return (
    <div title={`${title}: ${value}`} style={{ width: 44, padding: '8px 4px', borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <Icon size={14} color={color}/>
      <div className="num" style={{ fontSize: 10, fontWeight: 800, color: T.text, maxWidth: 38, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof value === 'number' ? Number(value || 0).toLocaleString() : value}</div>
    </div>
  );
}

/* ── Interactive Donut Pie Chart ── */
function InteractivePieChart({ automated, notAutomated, none, total, onClickAutomated, onClickNotAutomated, onClickNone, deltaAutomated, baselineAt, nav }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0, visible: false });

  useEffect(() => { if (nav !== 'testcases') setSelected(null); }, [nav]);

  const hasData = total > 0;
  const segments = [
    { key: 'automated',     label: 'Automated',     count: automated,    color: T.green,   dimColor: T.greenDark, onClick: onClickAutomated },
    { key: 'not_automated', label: 'Not Automated', count: notAutomated, color: T.red,     dimColor: T.redDark,   onClick: onClickNotAutomated },
    { key: 'none',          label: 'No Status',     count: none,         color: T.textDim, dimColor: T.textMuted, onClick: onClickNone },
  ];

  const cx = 50, cy = 50, R = 42, r = 28;
  const GAP_DEG = 2;

  const toXY = (angleDeg, radius) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  function arcPath(sa, ea, outerR, innerR) {
    if (Math.abs(ea - sa) >= 359.5) {
      const m = sa + (ea - sa) / 2;
      const o1 = toXY(sa, outerR), o2 = toXY(m, outerR), o3 = toXY(ea - 0.01, outerR);
      const i1 = toXY(sa, innerR), i2 = toXY(m, innerR), i3 = toXY(ea - 0.01, innerR);
      return `M${o1.x} ${o1.y} A${outerR} ${outerR} 0 1 1 ${o2.x} ${o2.y} A${outerR} ${outerR} 0 1 1 ${o3.x} ${o3.y}
              L${i3.x} ${i3.y} A${innerR} ${innerR} 0 1 0 ${i2.x} ${i2.y} A${innerR} ${innerR} 0 1 0 ${i1.x} ${i1.y} Z`;
    }
    const lg = ea - sa > 180 ? 1 : 0;
    const o1 = toXY(sa, outerR), o2 = toXY(ea, outerR);
    const i1 = toXY(ea, innerR), i2 = toXY(sa, innerR);
    return `M${o1.x} ${o1.y} A${outerR} ${outerR} 0 ${lg} 1 ${o2.x} ${o2.y} L${i1.x} ${i1.y} A${innerR} ${innerR} 0 ${lg} 0 ${i2.x} ${i2.y} Z`;
  }

  let arcs = [];
  if (hasData) {
    const visSegs = segments.filter(s => s.count > 0);
    let angle = 0;
    visSegs.forEach((seg, idx) => {
      const sweep = (seg.count / total) * 360;
      const gapBefore = idx === 0 ? 0 : GAP_DEG / 2;
      const gapAfter  = idx === visSegs.length - 1 ? 0 : GAP_DEG / 2;
      const sa = angle + gapBefore;
      const ea = angle + sweep - gapAfter;
      if (ea > sa + 0.5) arcs.push({ ...seg, startAngle: sa, endAngle: ea, sweep });
      angle += sweep;
    });
    if (arcs.length === 1) { arcs[0].startAngle = 0; arcs[0].endAngle = 359.9; }
  }

  const activeSeg = hovered ? segments.find(s => s.key === hovered) : (selected ? segments.find(s => s.key === selected) : null);
  const autoPct = total > 0 ? Math.round((automated / total) * 100) : 0;
  const hasDelta = typeof deltaAutomated === 'number' && deltaAutomated !== 0 && hasData;
  const deltaTitle = hasDelta
      ? `${deltaAutomated > 0 ? '+' : ''}${deltaAutomated} automated case${Math.abs(deltaAutomated) !== 1 ? 's' : ''} vs this week's Monday baseline`
      : undefined;

  const tipW = 168;
  const tipX = Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1000) - tipW - 10);
  const tipY = Math.max(tooltip.y - 66, 8);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px', marginBottom: 4 }}
         onClick={(e) => {
           const tag = e.target.tagName.toLowerCase();
           if (tag !== 'button' && tag !== 'path') setSelected(null);
         }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', flexShrink: 0, width: 100, height: 100 }}>
          <svg width={100} height={100} viewBox="0 0 100 100" role="img" aria-label={hasData ? `${autoPct}% automated of ${total} cases` : 'No automation data'}>
            <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={T.borderLight} strokeWidth={R - r}/>
            {hasData ? arcs.map((arc) => {
              const isActive = hovered === arc.key || selected === arc.key;
              return (
                <path
                  key={arc.key}
                  className="pie-arc"
                  d={arcPath(arc.startAngle, arc.endAngle, isActive ? R + 2 : R, isActive ? r - 1 : r)}
                  fill={isActive ? arc.dimColor : arc.color}
                  style={{ cursor: 'pointer', transition: 'all 0.2s ease-out', filter: isActive ? 'brightness(1.2)' : 'none', opacity: (hovered || selected) && !isActive ? 0.4 : 1 }}
                  onMouseEnter={(e) => { setHovered(arc.key); setTooltip({ x: e.clientX, y: e.clientY, visible: true }); }}
                  onMouseLeave={() => { setHovered(null); setTooltip(t => ({ ...t, visible: false })); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selected === arc.key) setSelected(null);
                    else { setSelected(arc.key); arc.onClick?.(); }
                  }}
                >
                  <title>{`${arc.label}: ${arc.count.toLocaleString()} (${Math.round((arc.count / total) * 100)}%)`}</title>
                </path>
              );
            }) : (
              <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={T.border} strokeWidth={R - r} strokeDasharray="4 3"/>
            )}
            {activeSeg ? (
              <>
                <text x={cx} y={cy - 2} textAnchor="middle" fill={activeSeg.color} fontSize={20} fontWeight={800} fontFamily="inherit">
                  {Math.round((activeSeg.count / total) * 100)}%
                </text>
                <text x={cx} y={cy + 12} textAnchor="middle" fill={T.textDim} fontSize={10} fontWeight={600} fontFamily="inherit">
                  {Number(activeSeg.count).toLocaleString()}
                </text>
              </>
            ) : (
              <>
                <text x={cx} y={cy + (hasDelta ? -2 : 6)} textAnchor="middle" fill={hasData ? T.text : T.textDim} fontSize={hasData ? 22 : 14} fontWeight={800} fontFamily="inherit">
                  {hasData ? `${autoPct}%` : '--'}
                </text>
                {!hasData && (
                  <text x={cx} y={cy + 18} textAnchor="middle" fill={T.textDim} fontSize={8} fontWeight={600} letterSpacing="0.05em" fontFamily="inherit">NO DATA</text>
                )}
                {hasDelta && (
                  <text x={cx} y={cy + 14} textAnchor="middle" fill={deltaAutomated > 0 ? T.green : T.red} fontSize={9} fontWeight={700} fontFamily="inherit">
                    {deltaAutomated > 0 ? '▲' : '▼'} {Math.abs(deltaAutomated)} cases
                    <title>{deltaTitle}</title>
                  </text>
                )}
              </>
            )}
          </svg>
          {tooltip.visible && hovered && segments.find(s => s.key === hovered) && (() => {
            const hovSeg = segments.find(s => s.key === hovered);
            return (
              <div style={{
                position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: tipX, top: tipY,
                background: T.card, border: `1px solid ${hovSeg.color}55`, borderRadius: 9,
                padding: '6px 11px', boxShadow: '0 6px 20px rgba(0,0,0,.3)', whiteSpace: 'nowrap', minWidth: tipW,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: hovSeg.color, flexShrink: 0 }}/>
                  <span style={{ fontSize: 10, fontWeight: 700, color: hovSeg.color }}>{hovSeg.label}</span>
                </div>
                <div className="num" style={{ fontSize: 13, fontWeight: 800, color: T.text, marginTop: 2 }}>
                  {hovSeg.count.toLocaleString()} <span style={{ fontSize: 10, fontWeight: 500, color: T.textMuted }}>of {total.toLocaleString()} · {Math.round((hovSeg.count / total) * 100)}%</span>
                </div>
                <div style={{ fontSize: 8, color: T.textDim, marginTop: 3 }}>↗ Click to filter in Test Cases</div>
              </div>
            );
          })()}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {segments.map((seg) => {
            const isActive = hovered === seg.key || selected === seg.key;
            const hasCount = seg.count > 0;
            const pct = total > 0 ? Math.round((seg.count / total) * 100) : 0;
            return (
              <button
                key={seg.key}
                type="button"
                onClick={(e) => { e.stopPropagation(); if (selected === seg.key) setSelected(null); else { setSelected(seg.key); seg.onClick?.(); } }}
                onMouseEnter={() => setHovered(seg.key)}
                onMouseLeave={() => setHovered(null)}
                title={`${seg.label}: ${Number(seg.count).toLocaleString()} cases (${pct}%) — click to filter`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  borderRadius: 8, border: `1px solid ${isActive ? `${seg.color}50` : 'transparent'}`,
                  background: isActive ? `${seg.color}15` : 'transparent',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'all .14s', opacity: !hasCount && !isActive ? 0.5 : 1,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 4, background: seg.color, flexShrink: 0, opacity: hasCount ? 1 : 0.4 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? seg.color : T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {seg.label}
                  </div>
                  <div className="num" style={{ fontSize: 9, color: T.textDim, whiteSpace: 'nowrap' }}>
                    {Number(seg.count).toLocaleString()} · {pct}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {hasData && (
        <div
          title="Deltas are measured against an inventory snapshot taken at the start of this calendar week (Monday 00:00)."
          style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 9, paddingTop: 8, borderTop: `1px solid ${T.borderLight}`, fontSize: 9, color: T.textDim }}
        >
          <Info size={9}/>
          <span className="num">{total.toLocaleString()} cases total</span>
          {baselineAt && <span>· vs week baseline ({fmtDate(baselineAt, 'short')})</span>}
        </div>
      )}
    </div>
  );
}

/* ── Period Selector ── */
function PeriodSelector({ current, onChange }) {
  const options = [
    { value: '1d',   label: '24h' },
    { value: '7d',   label: '1 Week' },
    { value: '30d',  label: '1 Month' },
    { value: 'all',  label: 'All' },
  ];
  return (
    <div role="tablist" aria-label="Activity period" style={{ display: 'flex', gap: 3, marginBottom: 7, background: T.bgAlt, borderRadius: 9, padding: 3 }}>
      {options.map(opt => {
        const isActive = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`period-pill${isActive ? ' active' : ''}`}
            onClick={() => onChange?.(opt.value)}
            style={{
              flex: 1,
              padding: '6px 0', fontSize: 10, fontWeight: isActive ? 700 : 500,
              background: isActive ? T.gradBlue : 'transparent',
              color: isActive ? '#fff' : T.textDim,
              boxShadow: isActive ? '0 2px 6px rgba(96,165,250,.35)' : 'none',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function WeeklyActivityCard({ rows, onDrillAudit }) {
  const meta = {
    created:  { color: T.green,  icon: Plus,       label: 'New Cases' },
    moved_in: { color: T.teal,   icon: ArrowRight, label: 'Moved In' },
    moved_out:{ color: T.purple, icon: Move,       label: 'Moved Out' },
    deleted:  { color: T.red,    icon: Trash2,     label: 'Archived' },
    updated:  { color: T.yellow, icon: GitCommit,  label: 'Updated' },
  };

  const actionRows = (rows || []).filter(r => r.key !== 'total_cases');

  if (!actionRows.length) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 12px', textAlign: 'center', color: T.textDim, fontSize: 11 }}>
        No activity data
      </div>
    );
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
      {actionRows.map((row, index) => {
        const m = meta[row.key] || { color: T.yellow, icon: GitCommit, label: row.label };
        const { color, icon: RowIcon, label } = m;
        const delta = describeDelta(row.delta_pct);
        const dcol = delta.tone === 'up' ? T.green : delta.tone === 'down' ? T.red : T.textDim;
        const DeltaIcon = delta.kind === 'new' ? Sparkles : delta.kind === 'up' ? TrendingUp : delta.kind === 'down' ? TrendingDown : Minus;
        const hasAuditDrill = !!row.drill_audit;
        const isLast = index === actionRows.length - 1;

        return (
          <button
            key={row.key || index}
            type="button"
            className={hasAuditDrill ? 'activity-row' : undefined}
            onClick={() => hasAuditDrill && onDrillAudit?.(row)}
            aria-label={hasAuditDrill ? `${label}: ${row.count}, ${delta.label}. Open in audit stream.` : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px',
              background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left',
              borderBottom: isLast ? 'none' : `1px solid ${T.borderLight}`,
              cursor: hasAuditDrill ? 'pointer' : 'default',
            }}
          >
            <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color}22` }}>
              <RowIcon size={13} color={color}/>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                {label}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
                <DeltaIcon size={9} color={dcol}/>
                <span style={{ fontSize: 9, fontWeight: 600, color: dcol }}>{delta.label}</span>
              </div>
            </div>

            <div className="num" style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1.1, flexShrink: 0 }}>
              {Number(row.count || 0).toLocaleString()}
            </div>
            {hasAuditDrill && (
              <ChevronRight className="drill-caret" size={14} color={T.textDim} style={{ flexShrink: 0, transition: 'transform .15s, color .15s' }}/>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ContributorsCard({ contributors }) {
  const max = Math.max(...(contributors || []).map(item => item.share || 0), 1);
  const avatarColors = [T.blue, T.purple, T.teal, T.orange, T.pink];
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
      {(contributors || []).length === 0 ? (
        <div style={{ padding: '14px 12px', color: T.textDim, fontSize: 11, textAlign: 'center' }}>No contributors this period</div>
      ) : contributors.map((item, index) => {
        const unresolved = item.is_system || isUnknownActor(item.name);
        const initials = String(item.name || 'U').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
        const avatarBg = unresolved ? T.yellowDim : avatarColors[index % avatarColors.length];
        return (
          <div key={`${item.name}-${index}`}
               title={unresolved ? 'Display name could not be resolved — re-sync to attempt resolution from Jira.' : item.name}
               style={{
                 display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                 borderBottom: index === contributors.length - 1 ? 'none' : `1px solid ${T.borderLight}`,
               }}>
            <div style={{
              width: 28, height: 28, borderRadius: 9, flexShrink: 0,
              background: unresolved ? T.yellowDim : `${avatarBg}30`,
              color: unresolved ? T.yellow : avatarBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 800, border: `1px solid ${unresolved ? `${T.yellow}40` : `${avatarBg}40`}`,
            }}>
              {unresolved ? <AlertTriangle size={12}/> : initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: unresolved ? T.yellow : T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                {unresolved && <span style={{ fontSize: 8, fontWeight: 700, color: T.yellow, background: T.yellowDim, padding: '1px 5px', borderRadius: 5, flexShrink: 0 }}>UNRESOLVED</span>}
              </div>
              <div style={{ height: 3, background: T.bgAlt, borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
                <div style={{ width: `${Math.min((item.share || 0) / max * 100, 100)}%`, height: '100%', background: unresolved ? T.yellowDark : avatarBg, borderRadius: 2, transition: 'width .3s ease' }}/>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="num" style={{ fontSize: 12, fontWeight: 800, color: unresolved ? T.textDim : T.text }}>{Number(item.count || 0).toLocaleString()}</div>
              <div style={{ fontSize: 8, color: T.textDim, textTransform: 'uppercase', letterSpacing: '.04em' }}>events</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
