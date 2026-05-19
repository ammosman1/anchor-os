// src/lib/dates.js
// Shared date formatting utilities

function tsToDate(ts) {
  return ts?.toDate ? ts.toDate() : new Date(ts);
}

// Relative time: "just now", "5m ago", "2h ago", "3d ago", then short date
export function fmtRelativeDate(ts) {
  if (!ts) return '';
  const d    = tsToDate(ts);
  const diff = Date.now() - d;
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Absolute short date with year: "Jan 15, 2026"
export function fmtShortDate(ts) {
  if (!ts) return '';
  return tsToDate(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Today as YYYY-MM-DD
export function todayStr() {
  return new Date().toISOString().split('T')[0];
}
