import { useEffect, useRef, useState } from 'react';
import { acquireConnection, releaseConnection, CHEER_SHOW_MS, type Cheer } from '../lib/socket';
import { playReactionSound } from '../lib/sounds';
import { useSession } from './useSession';

/**
 * Tile reactions on screen right now (a clap or a shock sent by tapping a
 * player's tile). Each one lives CHEER_SHOW_MS and lands with a pop.
 */
export function useCheers(code: string, myName: string): Cheer[] {
  const [cheers, setCheers] = useState<Cheer[]>([]);
  const [, setTick] = useState(0);
  const token = useSession().session?.token ?? null;
  const heard = useRef(0);

  useEffect(() => {
    const conn = acquireConnection(code, true, token);
    const unsub = conn.subscribe((s) => setCheers(s.cheers));
    return () => {
      unsub();
      releaseConnection(code);
    };
  }, [code, token]);

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const live = cheers.filter((c) => now - c.at < CHEER_SHOW_MS);
  const soonest = live.length ? Math.min(...live.map((c) => c.at + CHEER_SHOW_MS)) : null;
  useEffect(() => {
    if (soonest == null) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), Math.max(0, soonest - Date.now()) + 30);
    return () => window.clearTimeout(id);
  }, [soonest]);

  // Every reaction pops, whoever it is aimed at (myName kept for callers).
  void myName;
  const newest = Math.max(0, ...live.map((c) => c.id));
  useEffect(() => {
    if (newest > heard.current) { heard.current = newest; playReactionSound(); }
  }, [newest]);

  return live;
}
