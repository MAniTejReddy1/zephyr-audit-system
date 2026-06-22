import React from 'react';
import './TableSkeletonLoader.css';

const TableSkeletonLoader = () => {
  const rows = Array.from({ length: 8 });

  return (
    <div className="qa-skeleton-container thin-scrollbar">
      {/* Mock Header skeleton */}
      <div className="qa-skeleton-header-section">
        <div className="qa-skeleton-header-top">
          <div className="qa-skeleton-shimmer title-block"></div>
          <div className="qa-skeleton-shimmer badge-block"></div>
        </div>
        <div className="qa-skeleton-header-meta">
          <div className="qa-skeleton-shimmer meta-item"></div>
          <div className="qa-skeleton-shimmer meta-item"></div>
          <div className="qa-skeleton-shimmer meta-item"></div>
        </div>
      </div>

      {/* Mock Stats Cards skeleton */}
      <div className="qa-skeleton-stats-grid">
        {[1, 2, 3, 4].map(idx => (
          <div key={idx} className="qa-skeleton-stats-card">
            <div className="qa-skeleton-shimmer card-icon"></div>
            <div className="card-details">
              <div className="qa-skeleton-shimmer card-label"></div>
              <div className="qa-skeleton-shimmer card-value"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Mock Toolbar skeleton */}
      <div className="qa-skeleton-toolbar">
        <div className="qa-skeleton-shimmer search-bar"></div>
        <div className="qa-skeleton-shimmer select-dropdown"></div>
        <div className="qa-skeleton-shimmer select-dropdown"></div>
      </div>

      {/* Mock Table skeleton */}
      <div className="qa-skeleton-table">
        <div className="qa-skeleton-table-header">
          <div className="header-cell select-col"></div>
          <div className="header-cell label-col">Test Case Objective & Metadata</div>
          <div className="header-cell status-col">Status</div>
          <div className="header-cell tester-col">Assigned Tester</div>
          <div className="header-cell bug-col">Bug ID</div>
        </div>

        <div className="qa-skeleton-table-body">
          {rows.map((_, rIdx) => (
            <div key={rIdx} className="qa-skeleton-row">
              {/* Checkbox column */}
              <div className="qa-skeleton-cell select-col">
                <div className="qa-skeleton-shimmer checkbox-box"></div>
              </div>

              {/* Label & key column */}
              <div className="qa-skeleton-cell label-col">
                <div className="qa-skeleton-shimmer text-line primary"></div>
                <div className="qa-skeleton-shimmer text-line secondary"></div>
              </div>

              {/* Status pill column */}
              <div className="qa-skeleton-cell status-col">
                <div className="qa-skeleton-shimmer status-pill"></div>
              </div>

              {/* Tester avatar + text column */}
              <div className="qa-skeleton-cell tester-col">
                <div className="tester-wrapper">
                  <div className="qa-skeleton-shimmer avatar-circle"></div>
                  <div className="qa-skeleton-shimmer name-bar"></div>
                </div>
              </div>

              {/* Bug tag column */}
              <div className="qa-skeleton-cell bug-col">
                {rIdx % 3 === 0 ? (
                  <div className="qa-skeleton-shimmer bug-tag"></div>
                ) : (
                  <div className="qa-skeleton-shimmer bug-placeholder"></div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TableSkeletonLoader;