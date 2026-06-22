import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, FileText, AlertTriangle, AlertCircle, UploadCloud, Trash2, ListChecks, Calendar, CheckSquare, Square } from 'lucide-react';
import JiraStatus from './JiraStatus';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants.jsx';
import { apiFetch } from '../../utils';
import './RightDetailsDrawer.css';

const RightDetailsDrawer = ({ 
  item, 
  onClose, 
  updateItem, 
  availableTesters = [], 
  isOpen,
  isCycleLocked,
  isAdmin
}) => {
  const isEditable = !isCycleLocked || isAdmin;
  const [evidence, setEvidence] = useState(item.evidence || []);
  const [isDragging, setIsDragging] = useState(false);
  const [showDropzone, setShowDropzone] = useState(false);
  
  // Lazy loaded checklist transformer details
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'steps', 'history'

  const [checkedSteps, setCheckedSteps] = useState(() => {
    try {
      const saved = localStorage.getItem(`checked_steps_${item.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const drawerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (e.target.closest('tr') || e.target.closest('.qa-table')) {
        return;
      }
      if (e.target.closest('.qa-status-dropdown') || e.target.closest('.qa-modal-overlay') || e.target.closest('.folder-select-dropdown')) {
        return;
      }
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Fetch full item details when drawer opens or active item changes
  useEffect(() => {
    if (!item) return;
    let isMounted = true;
    setLoading(true);
    setDetails(null);
    setIsEditingLabel(false);
    
    // Sync checked steps & tab reset
    try {
      const saved = localStorage.getItem(`checked_steps_${item.id}`);
      setCheckedSteps(saved ? JSON.parse(saved) : {});
    } catch {
      setCheckedSteps({});
    }
    setActiveTab('overview');

    apiFetch(`/cycles/${item.release_cycle_id}/items/${item.id}`)
      .then(data => {
        if (isMounted) {
          setDetails(data);
          setLabelValue(data.checklist_label || item.test_case?.name || '');
          setLoading(false);
        }
      })
      .catch(err => {
        console.error("Failed to load checklist item details:", err);
        if (isMounted) setLoading(false);
      });
      
    return () => { isMounted = false; };
  }, [item.id, item.release_cycle_id]);

  if (!item) return null;

  const needsAttention = (item.status === 'fail' || item.status === 'blocked') && !item.bug_id;

  const handleSaveLabel = async () => {
    if (!labelValue.trim()) return;
    try {
      const data = await apiFetch(`/cycles/${item.release_cycle_id}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist_label: labelValue.trim() })
      });
      setDetails(data);
      setIsEditingLabel(false);
      updateItem(item.id, { checklist_label: labelValue.trim(), label_overridden: true });
    } catch (err) {
      console.error("Failed to save label override:", err);
    }
  };

  const handleRegenerate = async () => {
    try {
      const data = await apiFetch(`/cycles/${item.release_cycle_id}/items/${item.id}/regenerate`, {
        method: 'POST'
      });
      setDetails(data);
      setLabelValue(data.checklist_label);
      setIsEditingLabel(false);
      updateItem(item.id, { checklist_label: data.checklist_label, label_overridden: false });
    } catch (err) {
      console.error("Failed to regenerate label:", err);
    }
  };

  const toggleStep = (idx) => {
    if (!isEditable) return;
    setCheckedSteps(prev => {
      const next = { ...prev, [idx]: !prev[idx] };
      try {
        localStorage.setItem(`checked_steps_${item.id}`, JSON.stringify(next));
      } catch (err) {
        console.error(err);
      }
      return next;
    });
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, [item, updateItem, evidence]);

  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files);
    handleFiles(files);
  }, [item, updateItem, evidence]);

  const handleFiles = useCallback((files) => {
    const newEvidence = [...evidence];
    files.forEach(file => {
      const fileUrl = URL.createObjectURL(file);
      newEvidence.push({ id: Date.now() + Math.random(), name: file.name, url: fileUrl, type: file.type });
    });
    setEvidence(newEvidence);
    updateItem(item.id, { evidence: newEvidence });
  }, [evidence, item, updateItem]);

  const handleRemoveEvidence = useCallback((idToRemove) => {
    const updatedEvidence = evidence.filter(file => file.id !== idToRemove);
    setEvidence(updatedEvidence);
    updateItem(item.id, { evidence: updatedEvidence });
  }, [evidence, item, updateItem]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const checkedCount = Object.values(checkedSteps).filter(Boolean).length;
  const totalSteps = details?.verification_points?.length || 0;

  return (
    <div ref={drawerRef} className={`qa-details-drawer ${isOpen ? 'open' : ''}`}>
      <div className="qa-details-drawer-header">
        <h2 className="qa-details-drawer-title">Checklist Item Details</h2>
        <button onClick={onClose} className="qa-details-drawer-close-btn">
          <X size={20} />
        </button>
      </div>

      {/* Tabbed Navigation */}
      <div className="qa-drawer-tabs">
        <button 
          className={`qa-drawer-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <FileText size={15} />
          Overview
        </button>
        <button 
          className={`qa-drawer-tab ${activeTab === 'steps' ? 'active' : ''}`}
          onClick={() => setActiveTab('steps')}
        >
          <ListChecks size={15} />
          Steps {totalSteps > 0 && `(${checkedCount}/${totalSteps})`}
        </button>
        <button 
          className={`qa-drawer-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <Calendar size={15} />
          Notes & Evidence
        </button>
      </div>

      <div className="qa-details-drawer-content thin-scrollbar">
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Title & Manual Override Editing Block */}
            <div className="qa-details-section">
              {isEditingLabel ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    type="text"
                    className="qa-details-input"
                    style={{ fontSize: 13, fontWeight: 500, width: '100%' }}
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button 
                      onClick={() => { setIsEditingLabel(false); setLabelValue(details?.checklist_label || item.checklist_label || item.test_case?.name || ''); }}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSaveLabel}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: 'none', background: 'var(--brand-accent)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4, flex: 1 }}>
                      {details?.checklist_label || item.checklist_label || item.test_case?.name || 'Untitled checklist item'}
                    </h3>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {isEditable && (
                        <button 
                          onClick={() => setIsEditingLabel(true)}
                          style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}
                        >
                          Edit
                        </button>
                      )}
                      {isEditable && (details?.label_overridden || item.label_overridden) && (
                        <button 
                          onClick={handleRegenerate}
                          style={{ background: 'none', border: 'none', color: 'var(--warning)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}
                          title="Reset manual edits and restore auto-cleaned label"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, background: 'var(--border-light, #1b2431)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', marginTop: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 10, color: 'var(--text-secondary)', opacity: 0.6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original Name / Full Gherkin Flow</div>
                    <div style={{ wordBreak: 'break-word', color: 'var(--text-primary)' }}>{item.test_case?.name}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Test Case Information (Objective, labels, custom fields, components, estimated time) */}
            {(() => {
              const rawSnapshot = details?.test_case?.raw_snapshot || item.test_case?.raw_snapshot;
              const objective = rawSnapshot?.objective;
              const labels = rawSnapshot?.labels;
              const component = rawSnapshot?.component;
              const estimatedTime = rawSnapshot?.estimatedTime;
              const customFields = rawSnapshot?.customFields;

              const hasMetadata = objective || (labels && labels.length > 0) || component || estimatedTime || customFields;
              if (!hasMetadata) return null;

              return (
                <div className="qa-details-section" style={{ gap: 12 }}>
                  <label className="qa-details-label">Test Case Information</label>
                  
                  {objective && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em', opacity: 0.7 }}>Objective</div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>{objective}</div>
                    </div>
                  )}

                  {labels && labels.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em', opacity: 0.7 }}>Labels</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        {labels.map((lbl, idx) => (
                          <span key={idx} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--border-light, #1b2431)', color: 'var(--brand-accent)', fontWeight: 600, border: '1px solid var(--border)' }}>
                            {lbl}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(component || estimatedTime) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                      {component && (
                        <div style={{ padding: '8px 10px', background: 'var(--border-light, #1b2431)', borderRadius: 6, border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Component</div>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{component}</div>
                        </div>
                      )}
                      {estimatedTime && (
                        <div style={{ padding: '8px 10px', background: 'var(--border-light, #1b2431)', borderRadius: 6, border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Estimated Time</div>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(estimatedTime / 60)} minutes</div>
                        </div>
                      )}
                    </div>
                  )}

                  {customFields && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em', opacity: 0.7 }}>Automation Coverage</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 2 }}>
                        <div style={{ background: 'var(--border-light, #1b2431)', border: '1px solid var(--border)', padding: '6px 8px', borderRadius: 4, textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, textTransform: 'uppercase', fontWeight: 600 }}>API</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: customFields.is_automated_in_api === 'Yes' ? 'var(--success, #10b981)' : 'var(--text-secondary)' }}>
                            {customFields.is_automated_in_api || 'No'}
                          </div>
                        </div>
                        <div style={{ background: 'var(--border-light, #1b2431)', border: '1px solid var(--border)', padding: '6px 8px', borderRadius: 4, textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, textTransform: 'uppercase', fontWeight: 600 }}>App</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: customFields.is_automated_in_app === 'Yes' ? 'var(--success, #10b981)' : 'var(--text-secondary)' }}>
                            {customFields.is_automated_in_app || 'No'}
                          </div>
                        </div>
                        <div style={{ background: 'var(--border-light, #1b2431)', border: '1px solid var(--border)', padding: '6px 8px', borderRadius: 4, textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, textTransform: 'uppercase', fontWeight: 600 }}>Web</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: customFields.is_automated_in_web === 'Yes' ? 'var(--success, #10b981)' : 'var(--text-secondary)' }}>
                            {customFields.is_automated_in_web || 'No'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Preconditions */}
            {!loading && details?.precondition && (
              <div className="qa-details-section" style={{ backgroundColor: 'var(--warning-dim)', padding: 12, borderRadius: 6, borderLeft: '3px solid var(--warning)' }}>
                <div style={{ display: 'flex', gap: 6, color: 'var(--warning)', fontWeight: 600, fontSize: 11, marginBottom: 4, alignItems: 'center' }}>
                  <AlertTriangle size={13} /> Precondition
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {details.precondition}
                </div>
              </div>
            )}

            {/* Config & Meta Selectors */}
            <div className="qa-details-section">
              <label className="qa-details-label">Configuration & Scope</label>
              <div className="qa-details-meta-selectors">
                <div className="qa-details-meta-field">
                  <label className="qa-meta-label">Assigned Tester</label>
                  <select 
                    className="qa-details-select"
                    value={item.assigned_to || ''}
                    onChange={(e) => updateItem(item.id, { assigned_to: e.target.value || null })}
                    disabled={!isEditable}
                  >
                    <option value="">Unassigned</option>
                    {availableTesters.map(tester => (
                      <option key={tester.id} value={tester.name}>{tester.name}</option>
                    ))}
                  </select>
                </div>

                <div className="qa-details-meta-field">
                  <label className="qa-meta-label">Platform Scope</label>
                  <select 
                    className="qa-details-select"
                    value={item.platform || ''}
                    onChange={(e) => updateItem(item.id, { platform: e.target.value || null })}
                    disabled={!isEditable}
                  >
                    <option value="">N/A</option>
                    {['Mobile', 'Web', 'API'].map(plat => (
                      <option key={plat} value={plat}>{plat}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="qa-details-info-grid" style={{ marginTop: 8 }}>
                <div className="qa-details-info-card">
                  <div className="qa-details-info-label">Priority</div>
                  <div className="qa-details-info-value">{item.test_case?.priority || 'Normal'}</div>
                </div>
                <div className="qa-details-info-card">
                  <div className="qa-details-info-label">Folder path</div>
                  <div className="qa-details-info-value" style={{ wordBreak: 'break-all', fontSize: 11, fontWeight: 500 }}>{item.test_case?.folder_path || 'Root'}</div>
                </div>
              </div>
            </div>

            {/* Bug tracking */}
            <div className="qa-details-section">
              <div className={`qa-details-bug-tracking ${needsAttention ? 'needs-attention' : ''}`}>
                {needsAttention && <div className="qa-details-bug-tracking-indicator"></div>}
                <label className="qa-details-label">
                  <AlertTriangle size={14} color={needsAttention ? 'var(--warning)' : 'var(--danger)'}/> Bug Tracking
                </label>
                <input
                  type="text"
                  className="qa-details-input"
                  value={item.bug_id || ''}
                  onChange={(e) => updateItem(item.id, { bug_id: e.target.value || null })}
                  placeholder="e.g. JIRA-1234"
                  disabled={!isEditable}
                />
                {needsAttention && (
                  <div className="qa-details-warning">
                    <AlertCircle size={14}/> Status is {item.status}, please link a bug ticket.
                  </div>
                )}
                {item.bug_id && <JiraStatus issueKey={item.bug_id} />}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'steps' && (
          <div className="qa-details-section">
            <label className="qa-details-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ListChecks size={14} /> Verification Checkpoints
              </span>
              {totalSteps > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'none' }}>
                  {checkedCount} of {totalSteps} done
                </span>
              )}
            </label>
            
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 12 }}>
                Loading verification checkpoints...
              </div>
            ) : details?.verification_points && details.verification_points.length > 0 ? (
              <>
                <div className="qa-report-bar-bg" style={{ height: 4, margin: '8px 0 16px' }}>
                  <div 
                    className="qa-report-bar-fill" 
                    style={{ 
                      width: `${Math.round((checkedCount / totalSteps) * 100)}%`, 
                      backgroundColor: 'var(--success)' 
                    }} 
                  />
                </div>
                
                <div className="qa-steps-checklist" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {details.verification_points.map((point, idx) => {
                    const isChecked = !!checkedSteps[idx];
                    return (
                      <div 
                        key={idx} 
                        onClick={() => toggleStep(idx)}
                        className={`qa-step-item ${isChecked ? 'checked' : ''} ${!isEditable ? 'disabled-step' : ''}`}
                      >
                        <div className="qa-step-checkbox">
                          {isChecked ? (
                            <CheckSquare size={16} className="checked-icon" />
                          ) : (
                            <Square size={16} className="unchecked-icon" />
                          )}
                        </div>
                        <div className="qa-step-text-container">
                          <span className="qa-step-number">{idx + 1}</span>
                          <span className="qa-step-text">{point}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)' }}>
                <ListChecks size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>No Verification Steps</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>This test case does not have defined verification steps.</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Testing Notes & Observations */}
            <div className="qa-details-section">
              <label className="qa-details-label">
                <FileText size={14}/> Testing Notes & Observations
              </label>
              <textarea
                className="qa-details-textarea"
                defaultValue={item.notes || ''}
                onBlur={(e) => {
                  if(e.target.value !== item.notes) updateItem(item.id, { notes: e.target.value })
                }}
                placeholder="Describe execution steps, test data used, or steps to reproduce if an issue was found..."
                disabled={!isEditable}
              />
              {isEditable && <div className="qa-details-hint">Notes are auto-saved when you click away.</div>}
            </div>

            {/* Evidence */}
            <div className="qa-details-section">
              <label className="qa-details-label">
                <UploadCloud size={14}/> Evidence Upload
              </label>
              {isEditable ? (
                (!showDropzone && evidence.length === 0) ? (
                  <button
                    type="button"
                    className="qa-btn-secondary"
                    onClick={() => setShowDropzone(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center', padding: '10px 0', borderStyle: 'dashed' }}
                  >
                    <UploadCloud size={16} /> Attach evidence
                  </button>
                ) : (
                  <div
                    className={`qa-evidence-dropzone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('evidence-upload-input').click()}
                  >
                    <UploadCloud size={24} />
                    <span>Drag & drop files here or click to upload</span>
                    <input
                      id="evidence-upload-input"
                      type="file"
                      multiple
                      onChange={handleFileInput}
                      style={{ display: 'none' }}
                    />
                  </div>
                )
              ) : (
                evidence.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0', border: '1px dashed var(--border)', borderRadius: 6 }}>
                    No evidence attached.
                  </div>
                )
              )}
              {evidence.length > 0 && (
                <div className="qa-evidence-previews">
                  {evidence.map(file => (
                    <div key={file.id} className="qa-evidence-preview-item">
                      {file.type.startsWith('image/') ? (
                        <img src={file.url} alt={file.name} className="qa-evidence-thumbnail" />
                      ) : (
                        <div className="qa-evidence-file-icon">
                          <FileText size={24} />
                          <span>{file.name}</span>
                        </div>
                      )}
                      {isEditable && (
                        <button onClick={() => handleRemoveEvidence(file.id)} className="qa-evidence-remove-btn">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent History */}
            {item.history && item.history.length > 0 && (
              <div className="qa-details-section qa-details-history">
                <label className="qa-details-label">Recent Activity Log</label>
                <div className="qa-details-history-list">
                  {item.history.slice(-3).reverse().map((h, idx) => (
                    <div key={idx} className="qa-details-history-item">
                      <span className="qa-details-history-timestamp">{new Date(h.timestamp).toLocaleString()}</span>
                      <span className="qa-details-history-change">Status:</span>
                      <span className="qa-details-history-old-status" style={{ color: STATUS_COLORS[h.old_status] }}>{STATUS_LABELS[h.old_status]}</span>
                      <span className="qa-details-history-arrow">→</span>
                      <span className="qa-details-history-new-status" style={{ color: STATUS_COLORS[h.new_status] }}>{STATUS_LABELS[h.new_status]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RightDetailsDrawer;