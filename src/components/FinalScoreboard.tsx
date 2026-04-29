import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { computeStandings, saveMultiplayerGame } from '../lib/history';
import { resetForNewGame } from '../lib/gameFlow';
import { isProduction } from '../lib/firebase';
import { setActiveRoomCode } from '../hooks/useActiveRoom';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function FinalScoreboard({ room, myName }: Props) {
  const navigate = useNavigate();
  const [savingState, setSavingState] = useState<
    'pending' | 'saving' | 'saved' | 'skipped' | 'error'
  >('pending');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const isHost = room.hostPlayerName === myName;
  const standings = computeStandings(room);

  // Persist to history exactly once per game. The function itself is
  // idempotent across clients (transactional claim), so it's safe for every
  // player's tab to fire it.
  useEffect(() => {
    if (room.historyWritten) {
      setSavingState('saved');
      return;
    }
    if (!isProduction()) {
      setSavingState('skipped');
      return;
    }
    setSavingState('saving');
    saveMultiplayerGame(room.code)
      .then(() => setSavingState('saved'))
      .catch(() => setSavingState('error'));
  }, [room.code, room.historyWritten]);

  async function handlePlayAgain() {
    setResetting(true);
    setResetError(null);
    try {
      await resetForNewGame(room.code, myName);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset.');
      setResetting(false);
    }
  }

  return (
    <div className="card-gold p-4 space-y-4">
      <div className="text-center">
        <div className="text-xs uppercase tracking-wider text-navy-200">
          Game over
        </div>
        <div className="text-2xl font-black text-gold-200 mt-1">
          {standings[0]?.name} wins!
        </div>
      </div>

      <ul className="space-y-1.5">
        {standings.map((s) => {
          const isMe = s.name === myName;
          return (
            <li
              key={s.name}
              className="flex items-center justify-between rounded-md bg-navy-800/60 px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span className="text-navy-200 text-sm w-6 text-center">
                  {MEDAL[s.rank] ?? `${s.rank}.`}
                </span>
                <span
                  className={
                    isMe ? 'font-bold text-gold-100' : 'text-navy-50'
                  }
                >
                  {s.name}
                  {isMe ? ' (you)' : ''}
                </span>
              </span>
              <span className="text-gold-100 font-bold tabular-nums">
                {s.score}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-center text-navy-300">
        {savingState === 'saving' && 'Saving to history…'}
        {savingState === 'saved' && '✓ Saved to history.'}
        {savingState === 'skipped' && 'History saving skipped (localhost).'}
        {savingState === 'error' && '⚠ Could not save to history.'}
      </p>

      {isHost && (
        <button
          type="button"
          onClick={handlePlayAgain}
          disabled={resetting}
          className="btn-gold w-full rounded-xl py-3"
        >
          {resetting ? 'Resetting…' : 'Play again'}
        </button>
      )}
      {resetError && (
        <p className="text-sm text-rose-300 text-center">{resetError}</p>
      )}

      <button
        type="button"
        onClick={() => {
          setActiveRoomCode(null);
          navigate('/');
        }}
        className="w-full text-sm text-navy-200 underline underline-offset-2 hover:text-gold-200"
      >
        Back to home
      </button>
    </div>
  );
}
