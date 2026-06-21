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
    <a href="#" className="inline-flex items-center gap-1.5 no-underline text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ color, backgroundColor: `${color}1A`, border: `1px solid ${color}40` }}>
      <LinkIcon size={10} />
      {status.status}
    </a>
  );
};

export default JiraStatus;
