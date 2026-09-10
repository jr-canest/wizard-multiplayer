import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addBot,
  BOT_DIFFICULTY_LABEL,
  botDifficultyOf,
  isBot,
  leaveRoom,
  removeBot,
  MIN_PLAYERS,
  MAX_PLAYERS,
} from '../lib/rooms';
import { setChosenTotalRounds, startGame } from '../lib/gameFlow';
import { totalRoundsFor } from '../game/deck';
import { setActiveRoomCode } from '../hooks/useActiveRoom';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { Chat } from './Chat';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';
import type { BotDifficulty } from '../lib/types';

const DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'expert'];

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
  const [botBusy, setBotBusy] = useState(false);
  const { uid } = useAnonymousAuth();

  const isHost = room.hostPlayerName === myName;
  const hasBots = room.playerOrder.some((n) => isBot(room, n));
  const roomFull = room.playerOrder.length >= MAX_PLAYERS;

  async function handleAddBot(difficulty: BotDifficulty) {
    if (!uid || botBusy || roomFull) return;
    setBotBusy(true);
    try {
      await addBot(room.code, myName, uid, difficulty);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Could not add computer.');
    } finally {
      setBotBusy(false);
    }
  }

  async function handleRemoveBot(name: string) {
    if (botBusy) return;
    setBotBusy(true);
    try {
      await removeBot(room.code, myName, name);
    } finally {
      setBotBusy(false);
    }
  }
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
          <span className="section-label">Room code</span>
          <span className="font-display font-bold text-[30px] leading-none tracking-[0.3em] text-gold-text">
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
          <span className="section-label">
            Players ({room.playerOrder.length}/{MAX_PLAYERS})
          </span>
          {room.canadianRule && (
            <span className="text-xs text-gold-text">Canadian rules</span>
          )}
        </div>
        <ul className="space-y-1.5">
          {room.playerOrder.map((name, idx) => {
            const meta = playersByName.get(name);
            const isMe = name === myName;
            const isHostRow = name === room.hostPlayerName;
            const difficulty = botDifficultyOf(room, name);
            return (
              <li
                key={name}
                className="card-gold-subtle flex items-center justify-between px-3 h-10"
              >
                <span className="flex items-center gap-2">
                  <span className="text-navy-300 text-xs w-4 text-right">
                    {idx + 1}
                  </span>
                  <span
                    className={`font-display font-semibold text-[17px] ${
                      isMe ? 'text-cream-bright' : 'text-cream'
                    }`}
                  >
                    {name}
                    {isMe ? ' (you)' : ''}
                  </span>
                  {isHostRow && (
                    <span className="text-gold-300 text-sm" title="Host">
                      ♛
                    </span>
                  )}
                  {difficulty && (
                    <span className="cpu-chip">
                      CPU · {BOT_DIFFICULTY_LABEL[difficulty]}
                    </span>
                  )}
                </span>
                {difficulty ? (
                  isHost ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveBot(name)}
                      disabled={botBusy}
                      aria-label={`Remove ${name}`}
                      className="h-7 w-7 -mr-1 rounded-md text-navy-200 hover:text-rose-300 text-base leading-none"
                    >
                      ×
                    </button>
                  ) : null
                ) : (
                  <span
                    className={`h-2 w-2 rounded-full ${
                      meta?.connected ? 'bg-emerald-400' : 'bg-navy-400'
                    }`}
                    title={meta?.connected ? 'Connected' : 'Disconnected'}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {room.playerOrder.length < MIN_PLAYERS && (
          <p className="text-xs text-navy-200 mt-2">
            Need at least {MIN_PLAYERS} players to start.
          </p>
        )}
        {hasBots && (
          <p className="text-xs text-navy-200 mt-2">
            Computers show in game history but never get player stats.
          </p>
        )}
      </div>

      {isHost && (
        <div className="card-gold p-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-cream font-semibold text-sm">Add a computer</span>
            <span className="text-[11px] text-navy-200">
              {roomFull ? 'Room is full' : 'Plays from your device'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleAddBot(d)}
                disabled={botBusy || roomFull || !uid}
                className="btn-secondary h-10 text-sm"
              >
                + {BOT_DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isHost ? (
        <>
          <div className="card-gold p-3 space-y-1">
            <label
              htmlFor="rounds"
              className="flex items-center justify-between text-sm"
            >
              <span className="text-cream font-semibold">Rounds</span>
              <select
                id="rounds"
                value={displayedChosen === null ? '' : String(displayedChosen)}
                onChange={handleRoundsChange}
                className="h-[30px] rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/40 px-2 text-cream text-xs font-semibold"
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
            className="btn-gold w-full h-[52px] text-lg"
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

