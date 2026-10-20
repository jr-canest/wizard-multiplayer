import { useEffect, useState } from 'react';
import { acquireConnection, connectionFor, peekChat, releaseConnection, type ChatLine } from '../lib/socket';
import { useSession } from './useSession';

/** Chat lines for this room, live from the socket. */
export function useChat(code: string): ChatLine[] {
  const [chat, setChat] = useState<ChatLine[]>(() => peekChat(code));
  const token = useSession().session?.token ?? null;

  useEffect(() => {
    const conn = acquireConnection(code, true, token);
    const unsub = conn.subscribe((s) => setChat(s.chat));
    return () => {
      unsub();
      releaseConnection(code);
    };
  }, [code, token]);

  return chat;
}

/** Others with a chat draft going right now, in seat order. */
export function useTyping(code: string, playerOrder: string[], myName: string): string[] {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);
  const token = useSession().session?.token ?? null;

  useEffect(() => {
    const conn = acquireConnection(code, true, token);
    const unsub = conn.subscribe((s) => setTyping(s.typing));
    return () => {
      unsub();
      releaseConnection(code);
    };
  }, [code, token]);

  // Date.now() in render on purpose: the timer re-renders when the
  // soonest hint runs out.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const live = Object.entries(typing).filter(([n, until]) => until > now && n !== myName);
  const soonest = live.length ? Math.min(...live.map(([, u]) => u)) : null;
  useEffect(() => {
    if (soonest == null) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), Math.max(0, soonest - Date.now()) + 30);
    return () => window.clearTimeout(id);
  }, [soonest]);

  const names = new Set(live.map(([n]) => n));
  return playerOrder.filter((n) => names.has(n));
}

/**
 * Tells the table while the draft is being typed: each edit refreshes the
 * hint (throttled in the connection), so a draft left sitting lapses on
 * its own after TYPING_TTL_MS. Clearing the box or unmounting stops it.
 */
export function useReportTyping(code: string, draft: string): void {
  useEffect(() => {
    connectionFor(code).typing(draft.trim().length > 0);
  }, [code, draft]);
  useEffect(() => () => connectionFor(code).typing(false), [code]);
}
