import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { leaveRoom, MIN_PLAYERS, MAX_PLAYERS } from '../lib/rooms';
import { setChosenTotalRounds, startGame } from '../lib/gameFlow';
import { totalRoundsFor } from '../game/deck';
import { setActiveRoomCode } from '../hooks/useActiveRoom';
import { Chat } from './Chat';
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
  const maxRounds = totalRoundsFor(room.playerOrder.length);
  const chosenRounds = room.chosenTotalRounds ?? null;
  // Clamp the displayed selection so it never exceeds the current cap.
  const displayedChosen =
    chosenRounds && chosenRounds > maxRounds ? maxRounds : chosenRounds;

  async function handleRoundsChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    const next = v === '' ? null : parseInt(v, 10);
    await setChosenTotalRounds(room.code, myName, next);
  }

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
    const url = `${window.location.origin}/room/${room.code}`;
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
      setActiveRoomCode(null);
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

      <Chat room={room} myName={myName} />

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
          <div className="card-gold p-3 space-y-1">
            <label
              htmlFor="rounds"
              className="flex items-center justify-between text-sm"
            >
              <span className="text-gold-100 font-semibold">Rounds</span>
              <select
                id="rounds"
                value={displayedChosen === null ? '' : String(displayedChosen)}
                onChange={handleRoundsChange}
                className="rounded-md bg-navy-800 border border-gold-700/60 px-2 py-1 text-gold-100 text-sm"
              >
                <option value="">
                  Auto · max {maxRounds}
                </option>
                {Array.from({ length: maxRounds }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-navy-200">
              You can always vote to end sooner.
            </p>
          </div>

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
        <>
          <div className="text-center text-xs text-navy-200">
            Rounds:{' '}
            <strong className="text-gold-100">
              {displayedChosen === null
                ? `auto (max ${maxRounds})`
                : displayedChosen}
            </strong>
          </div>
          <p className="text-center text-sm text-navy-100">
            Waiting for{' '}
            <strong className="text-gold-100">{room.hostPlayerName}</strong> to
            start…
          </p>
        </>
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

