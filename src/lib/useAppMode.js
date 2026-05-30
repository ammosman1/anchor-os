import { useState } from 'react';

export function useAppMode() {
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem('anchor-app-mode') || 'all'; } catch { return 'all'; }
  });

  const setMode = (m) => {
    setModeState(m);
    try { localStorage.setItem('anchor-app-mode', m); } catch {}
  };

  return [mode, setMode];
}
