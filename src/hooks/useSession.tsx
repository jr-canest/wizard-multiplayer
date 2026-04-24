import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'wizard-multiplayer.session';

export type Session = {
  playerId: string;
  playerName: string;
};

type SessionContextValue = {
  session: Session | null;
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
    return { playerId: parsed.playerId, playerName: parsed.playerName };
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => readStored());

  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  const setSession = useCallback((s: Session) => setSessionState(s), []);
  const clearSession = useCallback(() => setSessionState(null), []);

  const value = useMemo(
    () => ({ session, setSession, clearSession }),
    [session, setSession, clearSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
