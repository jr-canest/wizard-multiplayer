import { useEffect } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isBotName } from '../lib/rooms';
import { HEARTBEAT_INTERVAL_MS } from '../lib/presence';

/**
 * Periodically writes lastHeartbeatAt for the local player so other clients
 * can detect when this device has gone offline. No-ops for bots (their
 * driver runs on the host's connection) and when there's no session yet.
 */
export function useHeartbeat(code: string, name: string | null): void {
  useEffect(() => {
    if (!name || isBotName(name)) return;
    const ref = doc(db, 'rooms', code, 'players', name);
    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;
      try {
        await updateDoc(ref, { lastHeartbeatAt: serverTimestamp() });
      } catch {
        // Player doc may not exist yet (mid-join) — next tick will retry.
      }
    };

    beat();
    const id = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [code, name]);
}
