import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { SESSION_STORAGE_KEY as STORAGE_KEY } from '../lib/session';

export type Session = {
  playerId: string;
  playerName: string;
  /** Seat token from the game server's /session (name + PIN verified there). */
  token?: string;
};



type SessionContextValue = {
  session: Session | null;
  /** Asking the server-set cookie for a sign-in this phone's storage lost. */
  restoring: boolean;
  setSession: (s: Session) => void;
  clearSession: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.playerId !== 'string' || typeof parsed.playerName !== 'string') {
      return null;
    }
    return { playerId: parsed.playerId, playerName: parsed.playerName, token: typeof parsed.token === 'string' ? parsed.token : undefined };
  } catch {
    return null;
  }
}

// The sign-in is also kept in a cookie the site's own server sets
// (functions/ `remember`, 2026-10-29): Safari wipes localStorage after 7
// days without a visit, which signed people out between game nights, but
// leaves server-set cookies alone. Not on the dev server (no function).
const REMEMBER_URL = '/api/remember';
const useRemember = import.meta.env.PROD;
// A cold function can take a few seconds; past this, just ask for the PIN.
const RESTORE_TIMEOUT_MS = 6000;

function rememberOnServer(s: Session | null): void {
  if (!useRemember) return;
  const init: RequestInit = s?.token
    ? { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(s), keepalive: true }
    : { method: 'DELETE', keepalive: true };
  if (s && !s.token) return;
  fetch(REMEMBER_URL, init).catch(() => {});
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => readStored());
  const [restoring, setRestoring] = useState(() => useRemember && readStored() === null);

  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  // Storage came up empty: get the sign-in back from the cookie, if any.
  // A phone that still has it refreshes the cookie instead (which also
  // moves everyone signed in before this existed onto it).
  useEffect(() => {
    const stored = readStored();
    if (stored) { rememberOnServer(stored); return; }
    if (!useRemember) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), RESTORE_TIMEOUT_MS);
    fetch(REMEMBER_URL, { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session?: Session | null } | null) => {
        const s = data?.session;
        // Typed in meanwhile? Theirs wins.
        if (s?.token) setSessionState((cur) => cur ?? s);
      })
      .catch(() => {})
      .finally(() => { window.clearTimeout(timer); setRestoring(false); });
    return () => { ctl.abort(); window.clearTimeout(timer); };
  }, []);

  const setSession = useCallback((s: Session) => {
    setSessionState(s);
    setRestoring(false);
    rememberOnServer(s);
  }, []);
  const clearSession = useCallback(() => {
    setSessionState(null);
    rememberOnServer(null);
  }, []);

  const value = useMemo(
    () => ({ session, restoring, setSession, clearSession }),
    [session, restoring, setSession, clearSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// Hook lives in the same file as the provider on purpose — keeps the
// SessionContext private. Fast refresh handles hooks fine in practice.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
