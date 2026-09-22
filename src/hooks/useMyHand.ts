import { useEffect, useState } from 'react';
import { acquireConnection, releaseConnection } from '../lib/socket';
import { useSession } from './useSession';
import type { Card } from '../lib/types';

/** This player's cards, straight from the room socket (the server sends
 *  each socket its own hand and nobody else's). */
export function useMyHand(code: string, playerName: string | null): Card[] | null {
  const [hand, setHand] = useState<Card[] | null>(null);
  const token = useSession().session?.token ?? null;

  useEffect(() => {
    if (!playerName) return;
    const conn = acquireConnection(code, true, token);
    const unsub = conn.subscribe((s) => setHand(s.hand));
    return () => {
      unsub();
      releaseConnection(code);
    };
  }, [code, playerName, token]);

  return playerName ? hand : null;
}
