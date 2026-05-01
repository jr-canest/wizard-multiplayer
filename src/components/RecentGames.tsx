import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

const MEDAL_EMOJIS = ['🥇', '🥈', '🥉'];

type GameResult = {
  playerId?: string;
  name: string;
  score: number;
  rank: number;
  shamePoints?: number;
};

type GameDoc = {
  date: Timestamp | null;
  roundCount: number;
  playerCount: number;
  results: GameResult[];
  source?: string;
};

type GameRow = GameDoc & { id: string };

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RecentGames() {
  const [games, setGames] = useState<GameRow[] | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'games'),
      orderBy('date', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setGames(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as GameDoc) })),
        );
      },
      () => setGames([]),
    );
    return unsub;
  }, []);

  if (games === null) return null;
  if (games.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="px-1 flex items-baseline justify-between">
        <h2 className="text-gold-200 text-sm font-semibold">Recent games</h2>
        <span className="text-navy-200/50 text-[11px]">last {games.length}</span>
      </div>
      <div className="space-y-3">
        {games.map((game) => {
          const results = [...(game.results ?? [])].sort(
            (a, b) => a.rank - b.rank,
          );
          return (
            <div key={game.id} className="card-gold p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gold-200/70 text-xs">
                  {formatDate(game.date)} — {game.roundCount} round
                  {game.roundCount !== 1 ? 's' : ''}
                </span>
                <span className="text-navy-200/50 text-xs">
                  {game.playerCount} players
                </span>
              </div>
              <div className="space-y-1">
                {results.map((r, ri) => {
                  const medal = ri < 3 ? MEDAL_EMOJIS[ri] : null;
                  const shame = r.shamePoints ?? 0;
                  return (
                    <div
                      key={`${r.playerId ?? r.name}-${ri}`}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-xs font-bold w-6 ${
                            ri === 0 ? 'text-gold-200' : 'text-navy-200'
                          }`}
                        >
                          {medal || `${r.rank}.`}
                        </span>
                        <span
                          className={`text-sm truncate ${
                            ri === 0
                              ? 'text-white font-medium'
                              : 'text-gray-300'
                          }`}
                        >
                          {r.name}
                        </span>
                        {shame > 0 && (
                          <span className="text-red-400 text-[10px]">
                            💀{shame > 1 ? `×${shame}` : ''}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          r.score > 0
                            ? 'text-emerald-400'
                            : r.score < 0
                              ? 'text-rose-400'
                              : 'text-navy-200'
                        }`}
                      >
                        {r.score}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
