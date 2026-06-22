import React, { useState, useEffect, useRef } from 'react';
import {
  RotateCcw, RefreshCw, Settings, Database, AlertCircle, Folder,
  List, ExternalLink, Layers, AlertTriangle, Trash2, Users,
  XCircle, CheckCircle2, Hash, History, HelpCircle
} from 'lucide-react';

import { T, useSessionState, API_BASE, API_KEY } from '../theme';
import { apiFetch, pluralize, fmtDate } from '../utils';

export default function ConfigView({ config, actors, folders, onRefresh, stats }) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [pollInterval, setPollInterval] = useSessionState('config_pollInterval', null);
  const [activeTab, setActiveTab] = useState('sync');
  const [showUsers, setShowUsers] = useState(false);
  const intervalRef = useRef(null);
  const syncingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const waitForSyncCompletion = async (triggeredAt = 0) => {
    for (let attempt = 0; attempt < 180; attempt++) {
      if (!mountedRef.current) throw new Error('unmounted');
      const status = await apiFetch('/sync/status');
      const startedAt = status.started_at ? new Date(status.started_at).getTime() : 0;
      if (!status.running && (!triggeredAt || startedAt >= triggeredAt)) return status;
      if (!mountedRef.current) throw new Error('unmounted');
      if (status.running) setSyncStatus({ type: 'info', message: `Sync running since ${fmtDate(status.started_at, 'time')}...` });
      else setSyncStatus({ type: 'info', message: 'Waiting for poller to start...' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('Sync status timed out');
  };

  const handleSync = async (source = 'manual') => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncStatus({ type: 'info', message: `Starting ${source === 'auto' ? 'auto' : 'manual'} sync with Zephyr Scale...` });
    try {
      const triggeredAt = Date.now();
      await apiFetch(`/sync/run?source=${source}`, { method: 'POST' });
      const finalStatus = await waitForSyncCompletion(triggeredAt);
      await onRefresh();
      if (!mountedRef.current) return;
      setSyncStatus({ type: 'success', message: `Sync complete: ${pluralize(finalStatus.total_logged || 0, 'change')} logged.` });
      setTimeout(() => { if (mountedRef.current) setSyncStatus(null); }, 3000);
    } catch (e) {
      if (mountedRef.current && e.message !== 'unmounted') setSyncStatus({ type: 'error', message: `Sync failed: ${e.message}` });
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) setSyncing(false);
    }
  };

  const handleReset = async () => {
    if (resetConfirmText !== 'RESET') return;
    setResetting(true);
    try {
      await fetch(API_BASE + '/reset', { method: 'POST', headers: API_KEY ? { 'X-API-Key': API_KEY } : {} });
      setSyncStatus({ type: 'success', message: 'Database cleared! Ready for fresh sync.' });
      setShowResetConfirm(false);
      setResetConfirmText('');
      setTimeout(onRefresh, 500);
    } catch (e) {
      setSyncStatus({ type: 'error', message: `Reset failed: ${e.message}` });
    }
    setResetting(false);
  };

  const startAutoPoll = (minutes) => {
    setPollInterval(minutes);
    setSyncStatus({ type: 'info', message: `Auto-sync: every ${minutes}m` });
    setTimeout(() => setSyncStatus(null), 2000);
  };

  const stopAutoPoll = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPollInterval(null);
  };

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (pollInterval) intervalRef.current = setInterval(() => handleSync('auto'), pollInterval * 60 * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [pollInterval]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/sync/status')
        .then(async (status) => {
          if (cancelled || !status.running) return;
          syncingRef.current = true;
          setSyncing(true);
          setSyncStatus({ type: 'info', message: 'Sync is already running. Waiting for completion...' });
          const finalStatus = await waitForSyncCompletion();
          if (cancelled) return;
          await onRefresh();
          setSyncStatus({ type: 'success', message: `Sync complete: ${pluralize(finalStatus.total_logged || 0, 'change')} logged.` });
          setTimeout(() => setSyncStatus(null), 3000);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) { syncingRef.current = false; setSyncing(false); } });
    return () => { cancelled = true; };
  }, []);

  const tabs = [
    { id: 'sync', label: 'Sync & Polling', icon: RefreshCw },
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'data', label: 'Data & Users', icon: Database },
  ];

  return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
        <div style={{ padding: '24px 32px', borderBottom: `1px solid ${T.border}`, background: T.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, marginBottom: 4 }}>Settings</h1>
              <p style={{ fontSize: 14, color: T.textMuted }}>Manage sync, configuration, and view system data</p>
            </div>
            <button onClick={onRefresh} style={{
              padding: '10px 20px', borderRadius: 10, border: `1px solid ${T.border}`,
              background: T.card, color: T.text, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8
            }}>
              <RotateCcw size={14}/> Refresh
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} aria-current={isActive ? 'page' : undefined} style={{
                    padding: '10px 20px', borderRadius: 10, border: 'none',
                    background: isActive ? T.gradBlue : 'transparent', color: isActive ? '#fff' : T.textMuted,
                    fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, transition: 'all .2s ease'
                  }}>
                    <Icon size={14}/> {tab.label}
                  </button>
              );
            })}
          </div>
        </div>

        {syncStatus && (
            <div style={{
              margin: '16px 32px 0', padding: 14, borderRadius: 10,
              background: syncStatus.type === 'error' ? T.redDim : syncStatus.type === 'success' ? T.greenDim : T.blueDim,
              border: `1px solid ${syncStatus.type === 'error' ? T.red : syncStatus.type === 'success' ? T.green : T.blue}40`,
              display: 'flex', alignItems: 'center', gap: 10, animation: 'slideIn .2s ease'
            }}>
              {syncStatus.type === 'error' ? <XCircle size={18} color={T.red}/> :
                  syncStatus.type === 'success' ? <CheckCircle2 size={18} color={T.green}/> :
                      <RefreshCw size={18} color={T.blue} style={{ animation: 'spin 1s linear infinite' }}/>}
              <span style={{ fontSize: 13, color: T.text }}>{syncStatus.message}</span>
            </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {activeTab === 'sync' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 20 }}>Quick Actions</h3>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <button onClick={() => handleSync('manual')} disabled={syncing} style={{
                        padding: '16px 36px', borderRadius: 12, border: 'none',
                        background: syncing ? T.bgSurface : T.gradBlue, color: '#fff',
                        fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10,
                        boxShadow: syncing ? 'none' : '0 6px 20px rgba(96,165,250,.35)'
                      }}>
                        <RefreshCw size={18} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}/>
                        {syncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                      {pollInterval ? (
                          <button onClick={stopAutoPoll} style={{
                            padding: '16px 28px', borderRadius: 12, border: 'none', background: T.greenDim, color: T.green,
                            fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8
                          }}>
                            <div style={{ width: 8, height: 8, borderRadius: 4, background: T.green, animation: 'pulse 2s infinite' }}/>
                            Auto: {pollInterval}m — Click to Stop
                          </button>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Auto-Sync Schedule</h3>
                    <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>Automatically sync with Zephyr at regular intervals</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                      {[1, 5, 15, 30, 60].map(min => (
                          <button key={min} onClick={() => startAutoPoll(min)} style={{
                            padding: '14px 0', borderRadius: 10, border: `2px solid ${pollInterval === min ? T.green : T.border}`,
                            background: pollInterval === min ? T.greenDim : T.bgSurface,
                            color: pollInterval === min ? T.green : T.textSecondary, fontSize: 14, fontWeight: 600, textAlign: 'center'
                          }}>
                            {min < 60 ? `${min} min` : '1 hour'}
                          </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.red}30` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.red, marginBottom: 6 }}>Danger Zone</h3>
                    <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>Irreversible actions that affect your data</p>
                    {!showResetConfirm ? (
                        <button onClick={() => setShowResetConfirm(true)} style={{
                          padding: '12px 24px', borderRadius: 10, border: `1px solid ${T.red}40`,
                          background: 'transparent', color: T.red, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8
                        }}>
                          <Trash2 size={16}/> Clear All Data
                        </button>
                    ) : (
                        <div style={{ padding: 20, background: T.redDim, borderRadius: 12 }}>
                          <p style={{ fontSize: 14, color: T.text, marginBottom: 12 }}>
                            <strong>Are you sure?</strong> This deletes all test cases, audit logs, and user data. Type <strong>RESET</strong> to confirm.
                          </p>
                          <input
                              value={resetConfirmText} onChange={e => setResetConfirmText(e.target.value)} placeholder="Type RESET"
                              aria-label="Type RESET to confirm"
                              style={{ width: '100%', maxWidth: 220, padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.red}60`, background: T.bgSurface, color: T.text, fontSize: 13, marginBottom: 16 }}
                          />
                          <div style={{ display: 'flex', gap: 12 }}>
                            <button onClick={handleReset} disabled={resetting || resetConfirmText !== 'RESET'} style={{
                              padding: '12px 20px', borderRadius: 8, border: 'none',
                              background: resetConfirmText === 'RESET' ? T.red : T.bgSurface,
                              color: resetConfirmText === 'RESET' ? '#fff' : T.textDim, fontSize: 13, fontWeight: 600,
                              cursor: resetConfirmText === 'RESET' ? 'pointer' : 'not-allowed'
                            }}>
                              {resetting ? 'Clearing...' : 'Yes, Clear Everything'}
                            </button>
                            <button onClick={() => { setShowResetConfirm(false); setResetConfirmText(''); }} style={{
                              padding: '10px 20px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13
                            }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                    )}
                  </div>
                </div>
            )}

            {activeTab === 'config' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                      <AlertCircle size={18} color={T.yellow}/>
                      <span style={{ fontSize: 13, color: T.textMuted }}>Configuration is loaded from environment variables. Restart the server after making changes.</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <SettingsField label="Project Key" value={config?.project_key} icon={Hash}/>
                      <SettingsField label="Parent Folder ID" value={config?.parent_folder_id} icon={Folder}/>
                      <SettingsField label="Parent Folder Name" value={config?.parent_folder_name || '—'} icon={Folder}/>
                      <SettingsField label="Fetch Test Steps" value={config?.fetch_test_steps ? 'Enabled' : 'Disabled'} icon={List}/>
                    </div>
                  </div>
                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 20 }}>API Configuration</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                      <SettingsField label="Zephyr Scale API URL" value={config?.base_url} icon={ExternalLink} mono/>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <SettingsField label="Page Size" value={config?.api_max_limit} icon={Layers}/>
                        <SettingsField label="Archive Statuses" value={config?.archive_status_names?.join(', ') || 'Archived, Deprecated'} icon={AlertTriangle}/>
                      </div>
                    </div>
                  </div>
                </div>
            )}

            {activeTab === 'data' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                    <MiniStatCard icon={Layers} label="Test Cases" value={stats.total_cases} color={T.blue}/>
                    <MiniStatCard icon={Activity} label="Audit Logs" value={stats.total_logs} color={T.purple}/>
                    <MiniStatCard icon={Folder} label="Folders" value={folders.length} color={T.yellow}/>
                    <MiniStatCard icon={Users} label="Users" value={actors.length} color={T.teal}/>
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Tracked Users</h3>
                        <p style={{ fontSize: 13, color: T.textMuted }}>{pluralize(actors.length, 'user')} have made changes</p>
                      </div>
                      <button onClick={() => setShowUsers(!showUsers)} style={{
                        padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textSecondary, fontSize: 13
                      }}>
                        {showUsers ? 'Hide' : 'Show All'}
                      </button>
                    </div>
                    {showUsers && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxHeight: 300, overflowY: 'auto' }}>
                          {actors.map((a, i) => (
                              <div key={a.account_id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, background: T.bgSurface, border: `1px solid ${T.border}` }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: [T.gradBlue, T.gradPurple, T.gradGreen, T.gradOrange, T.gradPink][i % 5], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>
                                  {(a.display_name || 'U').charAt(0).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 14, color: T.text, fontWeight: 600 }}>{a.display_name || 'Unknown'}</div>
                                  <div style={{ fontSize: 11, color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.account_id}</div>
                                </div>
                              </div>
                          ))}
                        </div>
                    )}
                  </div>

                  <div style={{ padding: 28, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 20 }}>Folder Structure</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                      <div style={{ padding: 20, background: T.bgSurface, borderRadius: 12, textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 32, fontWeight: 700, color: T.yellow }}>{folders.length}</div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Total Folders</div>
                      </div>
                      <div style={{ padding: 20, background: T.bgSurface, borderRadius: 12, textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 32, fontWeight: 700, color: T.blue }}>
                          {Math.max(...folders.map(f => (f.full_path?.split(' > ').length || 1)), 0)}
                        </div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Max Depth</div>
                      </div>
                      <div style={{ padding: 20, background: T.bgSurface, borderRadius: 12, textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 32, fontWeight: 700, color: T.green }}>{folders.filter(f => !f.parent_id).length}</div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Root Folders</div>
                      </div>
                    </div>
                  </div>
                </div>
            )}
          </div>
        </div>
      </div>
  );
}

function SettingsField({ label, value, icon: Icon, mono }) {
  return (
      <div style={{ padding: 16, background: T.bgSurface, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon size={14} color={T.textDim}/>
          <span style={{ fontSize: 11, color: T.textDim, textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 500, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', wordBreak: 'break-all' }}>
          {value || '—'}
        </div>
      </div>
  );
}

function MiniStatCard({ icon: Icon, label, value, color }) {
  return (
      <div style={{ padding: 20, background: T.card, borderRadius: 14, border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Icon size={18} color={color}/>
          <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>{label}</span>
        </div>
        <div className="num" style={{ fontSize: 28, fontWeight: 700, color: T.text }}>{(value || 0).toLocaleString()}</div>
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOADING SCREEN
   ═══════════════════════════════════════════════════════════════════ */
export function LoadingScreen() {
  return (
      <div style={{ height: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 28 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20, background: T.gradBlue,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 12px 40px rgba(96,165,250,.4)', animation: 'glow 2s ease-in-out infinite'
        }}>
          <History size={36} color="#fff"/>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: [T.blue, T.purple, T.teal][i], animation: `pulse 1.4s ${i * 0.15}s ease-in-out infinite` }}/>
          ))}
        </div>
        <span style={{ fontSize: 16, color: T.textMuted, fontWeight: 500 }}>Loading Sentinel QA...</span>
      </div>
  );
}
