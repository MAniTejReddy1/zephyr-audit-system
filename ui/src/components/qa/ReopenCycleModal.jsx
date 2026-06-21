import React, { useState } from 'react';
import './ReopenCycleModal.css';

const ReopenCycleModal = ({ cycleName, onConfirm, onCancel }) => {
  const [justification, setJustification] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    if (justification.trim().length < 10) { // Minimum length for justification
      setError('Please provide a detailed justification (at least 10 characters).');
      return;
    }
    onConfirm(justification);
  };

  return (
    <div className="qa-modal-overlay">
      <div className="qa-modal-content">
        <h3 className="qa-modal-title">Reopen Cycle: {cycleName}</h3>
        <p className="qa-modal-message">
          This cycle is currently "Signed Off" and locked. Reopening it will allow further modifications.
          Please provide a clear justification for this action, which will be logged in the audit trail.
        </p>
        <div className="qa-modal-form-group">
          <label htmlFor="justification" className="qa-modal-label">Justification:</label>
          <textarea
            id="justification"
            className="qa-modal-textarea"
            value={justification}
            onChange={(e) => { setJustification(e.target.value); setError(''); }}
            placeholder="e.g., 'Found critical bug in production, re-opening to re-test specific features.'"
            rows="5"
          />
          {error && <p className="qa-modal-error">{error}</p>}
        </div>
        <div className="qa-modal-actions">
          <button className="qa-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="qa-btn-primary" onClick={handleConfirm}>
            Reopen Cycle
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReopenCycleModal;