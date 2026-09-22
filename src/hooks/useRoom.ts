import { useEffect, useState } from 'react';
import { acquireConnection, releaseConnection, type ConnectionState } from '../lib/socket';
import { useSession } from './useSession';
export type { RoomSnapshot, PlayerSnapshot } from '../lib/socket';

type State = {
  room: ConnectionState['room'];
  players: ConnectionState['players'];
  loading: boolean;
  notFound: boolean;
  /** Why the server would not seat us, if it would not. */
  joinError: string | null;
  link: ConnectionState['link'];
};

/**
 * The live room. Opens (or shares) the socket to the game server for this
 * code and re-renders on every snapshot. Joining happens on connect: a
 * name not yet seated is added in the lobby, or refused with joinError.
 */
export function useRoom(code: string): State {
  const [cs, setCs] = useState<ConnectionState | null>(null);
  // Re-acquire when sign-in produces (or changes) the seat token, so a page
  // opened before sign-in gets a live socket without a reload.
  const token = useSession().session?.token ?? null;

  useEffect(() => {
    const conn = acquireConnection(code, true, token);
    const unsub = conn.subscribe(setCs);
    return () => {
      unsub();
      releaseConnection(code);
    };
  }, [code, token]);

  const error = cs?.error ?? null;
  return {
    room: cs?.room ?? null,
    players: cs?.players ?? [],
    loading: !cs || (cs.link === 'connecting' && !cs.error),
    notFound: error === 'roomNotFound',
    joinError: error && error !== 'roomNotFound' ? error : null,
    link: cs?.link ?? 'connecting',
  };
}
