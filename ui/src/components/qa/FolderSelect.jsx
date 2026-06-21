import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import Badge from '../ui/Badge';

const FolderSelect = ({ folders, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

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

  const selectedFolder = useMemo(() => folders.find(f => String(f.folder_id) === String(value)), [folders, value]);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div onClick={() => setIsOpen(!isOpen)} className="w-full px-4 py-3 rounded-lg text-sm bg-gray-800/50 border border-gray-700 flex justify-between items-center cursor-pointer" style={{ color: selectedFolder ? 'var(--text)' : 'var(--text-muted)' }}>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {selectedFolder ? selectedFolder.full_path : '-- Choose a folder --'}
        </span>
        <ChevronDown size={16} className="text-gray-500" />
      </div>
      
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl flex flex-col max-h-72">
          <div className="p-2 border-b border-gray-700">
            <input 
              type="text" 
              placeholder="Search folders..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-700 bg-gray-900 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredFolders.length === 0 ? (
              <div className="px-4 py-3 text-gray-500 text-sm text-center">No folders found</div>
            ) : (
              filteredFolders.map(f => (
                <div 
                  key={f.folder_id}
                  onClick={() => { onChange(f.folder_id); setIsOpen(false); setSearch(''); }}
                  className="px-4 py-2.5 cursor-pointer text-sm border-b border-gray-700/50 flex justify-between items-center hover:bg-gray-700 transition-colors"
                  style={{
                    backgroundColor: String(value) === String(f.folder_id) ? 'var(--blue-dim)' : '',
                    color: String(value) === String(f.folder_id) ? 'var(--blue)' : 'white',
                  }}
                >
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {f.full_path}
                  </span>
                  <Badge size="xs" color="var(--text-dim)">{f.test_case_count}</Badge>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FolderSelect;
