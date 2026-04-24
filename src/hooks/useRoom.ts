import { useEffect, useState } from 'react';
import {
  subscribeRoom,
  subscribeRoomPlayers,
} from '../lib/rooms';
import type { RoomDoc, RoomPlayerDoc } from '../lib/types';

export type RoomSnapshot = RoomDoc & { code: string };
export type PlayerSnapshot = RoomPlayerDoc & { name: string };

type State = {
  room: RoomSnapshot | null;
  players: PlayerSnapshot[];
  loading: boolean;
  notFound: boolean;
};

export function useRoom(code: string): State {
  const [state, setState] = useState<State>({
    room: null,
    players: [],
    loading: true,
    notFound: false,
  });

  useEffect(() => {
    let gotRoom = false;
    let gotPlayers = false;

    const unsubRoom = subscribeRoom(code, (room) => {
      gotRoom = true;
      setState((s) => ({
        ...s,
        room,
        notFound: room === null,
        loading: !(gotRoom && gotPlayers),
      }));
    });

    const unsubPlayers = subscribeRoomPlayers(code, (players) => {
      gotPlayers = true;
      setState((s) => ({
        ...s,
        players,
        loading: !(gotRoom && gotPlayers),
      }));
    });

    return () => {
      unsubRoom();
      unsubPlayers();
    };
  }, [code]);

  return state;
}
