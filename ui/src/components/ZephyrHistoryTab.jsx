import { useState, useEffect } from 'react';
import { apiFetch } from '../utils';

const ZephyrHistoryTab = ({ caseKey }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchHistory = async () => {
      try {
        const data = await apiFetch(`/testcases/${caseKey}/zephyr_history`);
        if (isMounted) setHistory(data);
      } catch {
        if (isMounted) setError('Failed to load Zephyr history.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchHistory();
    return () => { isMounted = false; };
  }, [caseKey]);

  if (loading) return <p>Loading Zephyr history...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4">Zephyr's Real-time Audit Log</h3>
      <div className="flex flex-col gap-4">
        {history.map((entry, index) => (
          <div key={index} className="bg-slate-800/50 p-4 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-blue-400">{entry.author}</span>
              <span className="text-xs text-slate-500">{new Date(entry.created).toLocaleString()}</span>
            </div>
            <ul className="list-disc list-inside">
              {entry.items.map((item, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold">{item.field}:</span> 
                  <span className="text-red-400 line-through">{item.old_value || 'N/A'}</span> → 
                  <span className="text-green-400">{item.new_value || 'N/A'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ZephyrHistoryTab;