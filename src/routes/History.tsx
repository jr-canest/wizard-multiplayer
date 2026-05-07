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

type PlayerRow = {
  id: string;
  name: string;
  gamesPlayed?: number;
  wins?: number;
  totalScore?: number;
  bestScore?: number | null;
  totalShamePoints?: number;
};

type Tab = 'players' | 'games';

const SORT_COLUMNS: Array<{
  key: 'winRate' | 'wins' | 'gamesPlayed' | 'avg' | 'bestScore';
  label: string;
  width: string;
}> = [
  { key: 'winRate', label: 'Win%', width: 'w-14' },
  { key: 'wins', label: 'W', width: 'w-10' },
  { key: 'gamesPlayed', label: 'GP', width: 'w-10' },
  { key: 'avg', label: 'Avg', width: 'w-14' },
  { key: 'bestScore', label: 'Best', width: 'w-14' },
];

function getPlayerSortValue(p: PlayerRow, key: typeof SORT_COLUMNS[number]['key']): number {
  const gp = p.gamesPlayed ?? 0;
  switch (key) {
    case 'winRate':
      return gp > 0 ? (p.wins ?? 0) / gp : 0;
    case 'wins':
      return p.wins ?? 0;
    case 'gamesPlayed':
      return gp;
    case 'avg':
      return gp > 0 ? (p.totalScore ?? 0) / gp : 0;
    case 'bestScore':
      return p.bestScore ?? -Infinity;
  }
}

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function History() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('players');
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [players, setPlayers] = useState<PlayerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] =
    useState<typeof SORT_COLUMNS[number]['key']>('winRate');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    const gamesQ = query(
      collection(db, 'games'),
      orderBy('date', 'desc'),
      limit(100),
    );
    const playersQ = query(
      collection(db, 'players'),
      orderBy('totalScore', 'desc'),
    );
    Promise.all([getDocs(gamesQ), getDocs(playersQ)])
      .then(([gSnap, pSnap]) => {
        setGames(
          gSnap.docs.map((d) => ({ id: d.id, ...(d.data() as GameDoc) })),
        );
        setPlayers(
          pSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<PlayerRow, 'id'>),
          })),
        );
      })
      .catch((err) => {
        console.error(err);
        setError('Could not load history.');
      });
  }, []);

  function handleSort(key: typeof SORT_COLUMNS[number]['key']) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const sortedPlayers = (players ?? []).slice().sort((a, b) => {
    const diff = getPlayerSortValue(b, sortKey) - getPlayerSortValue(a, sortKey);
    return sortAsc ? -diff : diff;
  });

  const loading = games === null || players === null;

  return (
    <div className="min-h-svh px-4 pt-6 pb-10">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gold-200">History</h1>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-navy-200 text-sm underline underline-offset-2"
          >
            ← Home
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab('players')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'players'
                ? 'btn-gold'
                : 'bg-navy-700/60 text-navy-200 active:bg-navy-600/60'
            }`}
          >
            All-Time Stats
          </button>
          <button
            type="button"
            onClick={() => setTab('games')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'games'
                ? 'btn-gold'
                : 'bg-navy-700/60 text-navy-200 active:bg-navy-600/60'
            }`}
          >
            Past Games
          </button>
        </div>

        {loading && !error && (
          <p className="text-navy-200 text-sm text-center py-12">
            Loading history…
          </p>
        )}

        {error && (
          <p className="text-rose-300 text-sm text-center py-12">{error}</p>
        )}

        {!loading && !error && tab === 'players' && (
          <>
            {sortedPlayers.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-navy-200 text-sm">
                  No games recorded yet.
                </p>
                <p className="text-navy-200/50 text-xs mt-1">
                  Finish a game to see stats here!
                </p>
              </div>
            ) : (
              <div className="card-gold overflow-hidden">
                <div className="px-3 py-2 border-b border-gold-700/40">
                  <div className="flex text-gold-200/70 text-xs font-medium">
                    <span className="w-8" />
                    <span className="flex-1">Player</span>
                    {SORT_COLUMNS.map((col) => (
                      <button
                        key={col.key}
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className={`${col.width} text-center active:text-gold-100 ${
                          col.key === 'bestScore' ? 'text-right' : ''
                        } ${sortKey === col.key ? 'text-gold-200' : ''}`}
                      >
                        {col.label}
                        {sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                      </button>
                    ))}
                  </div>
                </div>
                {sortedPlayers.map((p, i) => {
                  const gp = p.gamesPlayed ?? 0;
                  const avg = gp > 0 ? Math.round((p.totalScore ?? 0) / gp) : 0;
                  const winRate =
                    gp > 0 ? Math.round(((p.wins ?? 0) / gp) * 100) : 0;
                  const medal = i < 3 ? MEDAL_EMOJIS[i] : null;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center px-3 py-2.5 border-b border-gold-700/20 last:border-0 ${
                        i === 0 ? 'bg-gold-300/8' : ''
                      }`}
                    >
                      <span
                        className={`text-sm font-bold w-8 ${
                          i === 0 ? 'text-gold-200' : 'text-navy-200'
                        }`}
                      >
                        {medal || `${i + 1}.`}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-white font-medium text-sm truncate block">
                          {p.name}
                        </span>
                        {(p.totalShamePoints ?? 0) > 0 && (
                          <span className="text-rose-400 text-[10px]">
                            💀 {p.totalShamePoints}
                          </span>
                        )}
                      </div>
                      <span className="w-14 text-center text-gold-100 text-sm font-semibold">
                        {winRate}%
                      </span>
                      <span className="w-10 text-center text-emerald-400 text-sm font-semibold">
                        {p.wins ?? 0}
                      </span>
                      <span className="w-10 text-center text-navy-200 text-sm">
                        {gp}
                      </span>
                      <span
                        className={`w-14 text-center text-sm font-medium ${
                          avg > 0
                            ? 'text-emerald-400'
                            : avg < 0
                              ? 'text-rose-400'
                              : 'text-navy-200'
                        }`}
                      >
                        {avg}
                      </span>
                      <span className="w-14 text-right text-gold-200 text-sm font-medium">
                        {p.bestScore ?? '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {!loading && !error && tab === 'games' && (
          <>
            {(games ?? []).length === 0 ? (
              <div className="text-center py-12">
                <p className="text-navy-200 text-sm">No games recorded yet.</p>
                <p className="text-navy-200/50 text-xs mt-1">
                  Finish a game to see it here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {(games ?? []).map((game) => {
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
                                  <span className="text-rose-400 text-[10px]">
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
          </>
        )}
      </div>
    </div>
  );
}
