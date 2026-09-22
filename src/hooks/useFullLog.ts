import type { RoomSnapshot } from './useRoom';
import type { LogEntry } from '../lib/types';

/** The whole game log. The server sends the complete log once the game is
 *  finished, so on the final scoreboard room.log already is it. */
export function useFullLog(room: RoomSnapshot): { log: LogEntry[]; ready: boolean } {
  return { log: room.log, ready: true };
}
