import React from 'react';
import './TableSkeletonLoader.css'; // We'll create this CSS file next

const TableSkeletonLoader = () => {
  const rows = Array.from({ length: 10 }); // Number of skeleton rows
  const cols = Array.from({ length: 6 }); // Number of skeleton columns

  return (
    <div className="qa-skeleton-container">
      <div className="qa-skeleton-header">
        <div className="qa-skeleton-line short"></div>
        <div className="qa-skeleton-line medium"></div>
      </div>
      <div className="qa-skeleton-toolbar">
        <div className="qa-skeleton-line search"></div>
        <div className="qa-skeleton-filter-group">
          <div className="qa-skeleton-line filter-btn"></div>
          <div className="qa-skeleton-line filter-btn"></div>
          <div className="qa-skeleton-line filter-btn"></div>
        </div>
      </div>
      <div className="qa-skeleton-table">
        <div className="qa-skeleton-table-header">
          {cols.map((_, colIdx) => (
            <div key={colIdx} className="qa-skeleton-line header-cell"></div>
          ))}
        </div>
        {rows.map((_, rowIdx) => (
          <div key={rowIdx} className="qa-skeleton-table-row">
            {cols.map((_, colIdx) => (
              <div key={colIdx} className="qa-skeleton-line cell"></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TableSkeletonLoader;