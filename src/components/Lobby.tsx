import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { leaveRoom, MIN_PLAYERS, MAX_PLAYERS } from '../lib/rooms';
import { startGame } from '../lib/gameFlow';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  players: PlayerSnapshot[];
  myName: string;
};

export function Lobby({ room, players, myName }: Props) {
  const navigate = useNavigate();
  const [copying, setCopying] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const isHost = room.hostPlayerName === myName;
  const canStart =
    isHost && !starting && room.playerOrder.length >= MIN_PLAYERS;

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      await startGame(room.code, myName);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start.');
      setStarting(false);
    }
  }
  const playersByName = new Map(players.map((p) => [p.name, p]));

  async function handleCopyLink() {
    const url = `${window.location.origin}/wizard-multiplayer/room/${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopying(true);
      setTimeout(() => setCopying(false), 1200);
    } catch {
      // ignore
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      await leaveRoom(room.code, myName);
      navigate('/');
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="card-gold p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider text-navy-200">
            Room code
          </span>
          <span className="text-3xl font-black tracking-[0.3em] text-gold-200">
            {room.code}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopyLink}
          className="w-full text-sm text-navy-100 hover:text-gold-200 underline underline-offset-2"
        >
          {copying ? 'Link copied!' : 'Copy invite link'}
        </button>
      </div>

      <div className="card-gold p-4 space-y-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xs uppercase tracking-wider text-navy-200">
            Players ({room.playerOrder.length}/{MAX_PLAYERS})
          </span>
          {room.canadianRule && (
            <span className="text-xs text-gold-300">Canadian rules</span>
          )}
        </div>
        <ul className="space-y-1.5">
          {room.playerOrder.map((name, idx) => {
            const meta = playersByName.get(name);
            const isMe = name === myName;
            const isHostRow = name === room.hostPlayerName;
            return (
              <li
                key={name}
                className="flex items-center justify-between rounded-md bg-navy-800/60 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <span className="text-navy-300 text-xs w-4 text-right">
                    {idx + 1}
                  </span>
                  <span
                    className={
                      isMe
                        ? 'font-bold text-gold-100'
                        : 'text-navy-50'
                    }
                  >
                    {name}
                    {isMe ? ' (you)' : ''}
                  </span>
                  {isHostRow && (
                    <span className="text-gold-300 text-sm" title="Host">
                      ♛
                    </span>
                  )}
                </span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    meta?.connected ? 'bg-emerald-400' : 'bg-navy-400'
                  }`}
                  title={meta?.connected ? 'Connected' : 'Disconnected'}
                />
              </li>
            );
          })}
        </ul>
        {room.playerOrder.length < MIN_PLAYERS && (
          <p className="text-xs text-navy-200 mt-2">
            Need at least {MIN_PLAYERS} players to start.
          </p>
        )}
      </div>

      {isHost ? (
        <>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className="btn-gold w-full rounded-xl py-4 text-lg"
          >
            {starting ? 'Dealing…' : 'Start game'}
          </button>
          {startError && (
            <p className="text-sm text-rose-300 text-center">{startError}</p>
          )}
        </>
      ) : (
        <p className="text-center text-sm text-navy-100">
          Waiting for{' '}
          <strong className="text-gold-100">{room.hostPlayerName}</strong> to
          start…
        </p>
      )}

      <button
        type="button"
        onClick={handleLeave}
        disabled={leaving}
        className="w-full text-sm text-navy-200 underline underline-offset-2 hover:text-rose-300"
      >
        {leaving ? 'Leaving…' : 'Leave room'}
      </button>
    </div>
  );
}
