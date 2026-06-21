import React from 'react';
import './ConfirmationModal.css';

const ConfirmationModal = ({ title, message, confirmOptions, onConfirm, onCancel }) => {
  return (
    <div className="qa-modal-overlay">
      <div className="qa-modal-content">
        <h3 className="qa-modal-title">{title}</h3>
        <p className="qa-modal-message">{message}</p>
        <div className="qa-modal-actions">
          {confirmOptions.map(option => (
            <button
              key={option.value}
              className="qa-btn-primary"
              style={{ backgroundColor: option.color || 'var(--brand-accent)' }}
              onClick={() => onConfirm(option.value)}
            >
              {option.label}
            </button>
          ))}
          <button className="qa-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;