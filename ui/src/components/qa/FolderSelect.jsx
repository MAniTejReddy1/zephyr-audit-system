import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, X, CheckSquare, Square } from 'lucide-react';
import Badge from '../ui/Badge';
import './FolderSelect.css';

const FolderSelect = ({ folders, value = [], onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

  const selectedIds = useMemo(() => {
    return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredFolders = useMemo(() => {
    if (!search) return folders;
    return folders.filter(f => f.full_path.toLowerCase().includes(search.toLowerCase()));
  }, [folders, search]);

  const selectedFolders = useMemo(() => {
    return folders.filter(f => selectedIds.includes(String(f.folder_id)));
  }, [folders, selectedIds]);

  const handleToggleFolder = (folderId, event) => {
    if (event) event.stopPropagation();
    const strId = String(folderId);
    let next;
    if (selectedIds.includes(strId)) {
      next = selectedIds.filter(id => id !== strId);
    } else {
      next = [...selectedIds, strId];
    }
    // Convert back to numbers if original folders are numbers
    const finalNext = next.map(id => {
      const found = folders.find(f => String(f.folder_id) === id);
      return found ? found.folder_id : Number(id);
    });
    onChange(finalNext);
  };

  const handleSelectAll = (e) => {
    e.stopPropagation();
    const allIds = filteredFolders.map(f => f.folder_id);
    onChange(allIds);
  };

  const handleClearAll = (e) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div ref={wrapperRef} className="folder-select-wrapper">
      <div 
        onClick={() => setIsOpen(!isOpen)} 
        className="folder-select-display" 
      >
        <div className="folder-select-badges">
          {selectedFolders.length === 0 ? (
            <span className="folder-select-placeholder">-- Choose folders (multi-select) --</span>
          ) : (
            selectedFolders.map(f => (
              <span 
                key={f.folder_id} 
                className="folder-select-tag"
                onClick={(e) => handleToggleFolder(f.folder_id, e)}
              >
                {f.name || f.full_path.split(' > ').pop()}
                <X size={12} className="folder-select-tag-close" />
              </span>
            ))
          )}
        </div>
        <ChevronDown size={16} className={`folder-select-chevron ${isOpen ? 'open' : ''}`} />
      </div>
      
      {isOpen && (
        <div className="folder-select-dropdown">
          <div className="folder-select-search">
            <input 
              type="text" 
              placeholder="Search folders..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          
          <div className="folder-select-bulk-actions">
            <button type="button" onClick={handleSelectAll} className="folder-select-action-btn">
              Select Matches ({filteredFolders.length})
            </button>
            <button type="button" onClick={handleClearAll} className="folder-select-action-btn clear">
              Clear All
            </button>
          </div>

          <div className="folder-select-list thin-scrollbar">
            {filteredFolders.length === 0 ? (
              <div className="folder-select-empty">No folders found</div>
            ) : (
              filteredFolders.map(f => {
                const isSelected = selectedIds.includes(String(f.folder_id));
                return (
                  <div 
                    key={f.folder_id}
                    onClick={(e) => handleToggleFolder(f.folder_id, e)}
                    className={`folder-select-item ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="folder-select-item-left">
                      <span className="folder-select-item-checkbox">
                        {isSelected ? <CheckSquare size={16} color="var(--brand-accent)" /> : <Square size={16} />}
                      </span>
                      <span className="folder-select-item-path" title={f.full_path}>
                        {f.full_path}
                      </span>
                    </div>
                    <Badge size="xs" color="var(--brand-accent-dim)" style={{ color: 'var(--brand-accent)', border: 'none' }}>
                      {f.test_case_count}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FolderSelect;
