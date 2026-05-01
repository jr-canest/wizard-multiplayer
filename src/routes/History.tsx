import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  limit,
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

export function History() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'games'),
      orderBy('date', 'desc'),
      limit(100),
    );
    getDocs(q)
      .then((snap) => {
        setGames(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as GameDoc) })),
        );
      })
      .catch((err) => {
        console.error(err);
        setError('Could not load history.');
      });
  }, []);

  return (
    <div className="min-h-svh px-4 pt-6 pb-10">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gold-200">All games</h1>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-navy-200 text-sm underline underline-offset-2"
          >
            ← Home
          </button>
        </div>

        {games === null && !error && (
          <p className="text-navy-200 text-sm text-center py-12">
            Loading history…
          </p>
        )}

        {error && (
          <p className="text-rose-300 text-sm text-center py-12">{error}</p>
        )}

        {games !== null && games.length === 0 && (
          <div className="text-center py-12">
            <p className="text-navy-200 text-sm">No games recorded yet.</p>
            <p className="text-navy-200/50 text-xs mt-1">
              Finish a game to see it here.
            </p>
          </div>
        )}

        {games !== null && games.length > 0 && (
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
        )}
      </div>
    </div>
  );
}
