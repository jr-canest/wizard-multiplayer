import { useCallback, useEffect, useState } from 'react';

const KEY = 'wizard-multiplayer.activeRoom';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Imperative setter for places that don't need to subscribe to changes. */
export function setActiveRoomCode(next: string | null): void {
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    // localStorage may be unavailable (private mode); skip silently.
  }
  // Notify in-tab subscribers — the storage event only fires in *other* tabs.
  window.dispatchEvent(new CustomEvent('wizard-multiplayer:activeRoom'));
}

/**
 * Tracks the user's current room code in localStorage. Used by Home to
 * surface a "Rejoin" prompt when a session was interrupted.
 */
export function useActiveRoom(): {
  code: string | null;
  setCode: (next: string | null) => void;
} {
  const [code, setCodeState] = useState<string | null>(read);

  useEffect(() => {
    const sync = () => setCodeState(read());
    window.addEventListener('storage', sync);
    window.addEventListener('wizard-multiplayer:activeRoom', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('wizard-multiplayer:activeRoom', sync);
    };
  }, []);

  const setCode = useCallback((next: string | null) => {
    setActiveRoomCode(next);
    setCodeState(next);
  }, []);

  return { code, setCode };
}
