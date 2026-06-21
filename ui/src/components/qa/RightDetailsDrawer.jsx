import React, { useState, useCallback } from 'react';
import { X, FileText, AlertTriangle, AlertCircle, UploadCloud, Trash2, Image } from 'lucide-react';
import JiraStatus from './JiraStatus';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants.jsx';
import './RightDetailsDrawer.css';

const RightDetailsDrawer = ({ item, onClose, updateItem }) => {
  // Initialize evidence state with existing item evidence or an empty array
  const [evidence, setEvidence] = useState(item.evidence || []);
  const [isDragging, setIsDragging] = useState(false);

  if (!item) return null;

  const needsAttention = (item.status === 'fail' || item.status === 'blocked') && !item.bug_id;

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
      // In a real app, you'd upload the file to a server and get a URL
      // For this simulation, we'll use URL.createObjectURL for preview
      const fileUrl = URL.createObjectURL(file);
      newEvidence.push({ id: Date.now() + Math.random(), name: file.name, url: fileUrl, type: file.type });
    });
    setEvidence(newEvidence);
    // Update the parent component's item with new evidence (simulated)
    updateItem(item.id, { evidence: newEvidence });
  }, [evidence, item, updateItem]);

  const handleRemoveEvidence = useCallback((idToRemove) => {
    const updatedEvidence = evidence.filter(file => file.id !== idToRemove);
    setEvidence(updatedEvidence);
    // Update the parent component's item with updated evidence (simulated)
    updateItem(item.id, { evidence: updatedEvidence });
  }, [evidence, item, updateItem]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="qa-details-drawer">
      <div className="qa-details-drawer-header">
        <h2 className="qa-details-drawer-title">Test Case Details</h2>
        <button onClick={onClose} className="qa-details-drawer-close-btn">
          <X size={20} />
        </button>
      </div>

      <div className="qa-details-drawer-content">
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
          />
          <div className="qa-details-hint">Notes are auto-saved when you click away.</div>
        </div>

        <div className="qa-details-section">
          <label className="qa-details-label">
            <UploadCloud size={14}/> Evidence
          </label>
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
                  <button onClick={() => handleRemoveEvidence(file.id)} className="qa-evidence-remove-btn">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="qa-details-section">
          <div className={`qa-details-bug-tracking ${needsAttention ? 'needs-attention' : ''}`}>
            {needsAttention && <div className="qa-details-bug-tracking-indicator"></div>}
            <label className="qa-details-label">
              <AlertTriangle size={14} color={needsAttention ? 'var(--warning)' : 'var(--danger)'}/> Bug Tracking
            </label>
            <input
              type="text"
              className="qa-details-input"
              defaultValue={item.bug_id || ''}
              onBlur={(e) => {
                if(e.target.value !== item.bug_id) updateItem(item.id, { bug_id: e.target.value })
              }}
              placeholder="e.g. JIRA-1234"
            />
            {needsAttention && (
              <div className="qa-details-warning">
                <AlertCircle size={14}/> Status is {item.status}, please link a bug ticket.
              </div>
            )}
            {item.bug_id && <JiraStatus issueKey={item.bug_id} />}
          </div>
        </div>

        <div className="qa-details-section">
          <label className="qa-details-label">Test Case Info</label>
          <div className="qa-details-info-grid">
            <div className="qa-details-info-card">
              <div className="qa-details-info-label">Priority</div>
              <div className="qa-details-info-value">{item.test_case?.priority || 'Normal'}</div>
            </div>
            <div className="qa-details-info-card">
              <div className="qa-details-info-label">Status</div>
              <div className="qa-details-info-value">{item.test_case?.status || 'Draft'}</div>
            </div>
          </div>
        </div>

        {item.history && item.history.length > 0 && (
          <div className="qa-details-section qa-details-history">
            <label className="qa-details-label">Recent Activity</label>
            <div className="qa-details-history-list">
              {item.history.slice(-3).reverse().map((h, idx) => (
                <div key={idx} className="qa-details-history-item">
                  <span className="qa-details-history-timestamp">{new Date(h.timestamp).toLocaleString()}</span>
                  <span className="qa-details-history-change">Status changed:</span>
                  <span className="qa-details-history-old-status" style={{ color: STATUS_COLORS[h.old_status] }}>{STATUS_LABELS[h.old_status]}</span>
                  <span className="qa-details-history-arrow">→</span>
                  <span className="qa-details-history-new-status" style={{ color: STATUS_COLORS[h.new_status] }}>{STATUS_LABELS[h.new_status]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RightDetailsDrawer;