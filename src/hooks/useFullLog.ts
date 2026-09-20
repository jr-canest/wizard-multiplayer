import { useEffect, useState } from 'react';
import { loadFullLog } from '../lib/history';
import type { RoomSnapshot } from './useRoom';
import type { LogEntry } from '../lib/types';

type State = { code: string; log: LogEntry[] };

/**
 * The whole game log for a finished room: archived rounds stitched back
 * onto the room doc's own entries (see loadFullLog). Returns the doc's
 * log until the archives have loaded, so callers render immediately and
 * fill in once the fetch lands.
 */
export function useFullLog(room: RoomSnapshot): { log: LogEntry[]; ready: boolean } {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let alive = true;
    loadFullLog(room.code, room)
      .then((log) => {
        if (alive) setState({ code: room.code, log });
      })
      .catch(() => {
        // Leave it on the doc's log; the next status change retries.
      });
    return () => {
      alive = false;
    };
    // Refetch when the room finishes (the last archive is written then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code, room.status]);

  const ready = state?.code === room.code;
  return { log: ready ? state!.log : room.log, ready };
}
