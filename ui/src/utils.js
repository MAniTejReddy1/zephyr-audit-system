const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const API_KEY = import.meta.env.VITE_AUDIT_API_KEY || '';

export const apiFetch = async (path, options = {}) => {
  const headers = { ...options.headers, 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ detail: 'Request failed with status ' + res.status }));
    throw new Error(errorBody.detail || `API error ${res.status}`);
  }
  return res.json();
};
