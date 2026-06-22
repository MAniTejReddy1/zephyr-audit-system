import React, { useState, useEffect } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { apiFetch } from '../../utils';

const JiraStatus = ({ issueKey }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!issueKey) return;
    let isMounted = true;
    apiFetch(`/jira/issue/${issueKey}`)
      .then(data => { if (isMounted) setStatus(data); })
      .catch(() => { if (isMounted) setStatus({ status: 'Error' }); });
    return () => { isMounted = false; };
  }, [issueKey]);

  if (!status) return <span className="text-[10px] text-gray-500">Loading...</span>;

  const statusColors = {
    'To Do': 'var(--text-muted)',
    'In Progress': 'var(--blue)',
    'Done': 'var(--green)',
    'Error': 'var(--red)'
  };

  const color = statusColors[status.status] || 'var(--text-muted)';

  return (
    <a 
      href={status.url || '#'} 
      target={status.url ? "_blank" : undefined}
      rel="noopener noreferrer"
      style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '6px', 
        textDecoration: 'none', 
        fontSize: '11px', 
        fontWeight: 600, 
        padding: '2px 8px', 
        borderRadius: '4px', 
        color, 
        backgroundColor: `${color}1A`, 
        border: `1px solid ${color}40`,
        transition: 'all 150ms ease'
      }}
      onClick={(e) => { 
        if (!status.url) {
          e.preventDefault();
        }
        e.stopPropagation(); 
      }}
    >
      <LinkIcon size={10} />
      {status.status}
    </a>
  );
};

export default JiraStatus;
