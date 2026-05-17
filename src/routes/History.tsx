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
import { mergePlayerInto, MergePlayerError } from '../lib/players';
import {
  deleteHistoryGame,
  roundBreakdownFromLog,
  type GameRoundBreakdown,
} from '../lib/history';
import { ScoreLineGraph } from '../components/ScoreLineGraph';
import type { LogEntry, RoomDoc } from '../lib/types';

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
  log?: LogEntry[];
};

type GameRow = GameDoc & { id: string };

type GameDetail =
  | { mode: 'view'; game: GameRow }
  | { mode: 'confirmDelete'; game: GameRow }
  | { mode: 'deleting'; game: GameRow };

type PlayerRow = {
  id: string;
  name: string;
  gamesPlayed?: number;
  wins?: number;
  totalScore?: number;
  bestScore?: number | null;
  totalShamePoints?: number;
  aliases?: string[];
  mergedInto?: string;
};

type Tab = 'players' | 'games';

const SORT_COLUMNS: Array<{
  key: 'winRate' | 'wins' | 'gamesPlayed' | 'avg' | 'bestScore';
  label: string;
}> = [
  { key: 'winRate', label: 'Win%' },
  { key: 'wins', label: 'W' },
  { key: 'gamesPlayed', label: 'GP' },
  { key: 'avg', label: 'Avg' },
  { key: 'bestScore', label: 'Best' },
];

// Shared grid template for the All-Time Stats header + rows. Using
// the SAME grid template on both rules out any header/row drift —
// changing a column width here updates both at once.
//   rank | name (truncating) | Win% | W | GP | Avg | Best
const STATS_GRID =
  'grid grid-cols-[24px_minmax(0,1fr)_44px_26px_26px_44px_44px] items-center';

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

type DetailState =
  | { mode: 'view'; player: PlayerRow }
  | { mode: 'pickMergeTarget'; player: PlayerRow }
  | { mode: 'confirmMerge'; alias: PlayerRow; canonical: PlayerRow }
  | { mode: 'merging'; alias: PlayerRow; canonical: PlayerRow };

export function History() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('players');
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [players, setPlayers] = useState<PlayerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] =
    useState<typeof SORT_COLUMNS[number]['key']>('winRate');
  const [sortAsc, setSortAsc] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [gameDetail, setGameDetail] = useState<GameDetail | null>(null);
  const [gameDeleteError, setGameDeleteError] = useState<string | null>(null);

  async function loadPlayers() {
    const playersQ = query(
      collection(db, 'players'),
      orderBy('totalScore', 'desc'),
    );
    const pSnap = await getDocs(playersQ);
    setPlayers(
      pSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PlayerRow, 'id'>),
      })),
    );
  }

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

  // Hide players that have been merged into another (their stats live on
  // the canonical doc; they'd otherwise show as zero rows). Sorting and
  // ranking happens on the visible list.
  const visiblePlayers = (players ?? []).filter((p) => !p.mergedInto);

  const sortedPlayers = visiblePlayers.slice().sort((a, b) => {
    const diff = getPlayerSortValue(b, sortKey) - getPlayerSortValue(a, sortKey);
    return sortAsc ? -diff : diff;
  });

  async function applyMerge(canonical: PlayerRow, alias: PlayerRow) {
    setMergeError(null);
    setDetail({ mode: 'merging', alias, canonical });
    try {
      await mergePlayerInto(canonical.id, alias.id);
      await loadPlayers();
      setDetail(null);
    } catch (err) {
      const msg =
        err instanceof MergePlayerError
          ? `Merge failed: ${err.code}`
          : err instanceof Error
            ? err.message
            : 'Merge failed.';
      setMergeError(msg);
      setDetail({ mode: 'confirmMerge', alias, canonical });
    }
  }

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
                <div
                  className={`${STATS_GRID} px-3 py-2 border-b border-gold-700/40 text-gold-200/70 text-xs font-medium`}
                >
                  <span />
                  <span>Player</span>
                  {SORT_COLUMNS.map((col) => (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className={`active:text-gold-100 ${
                        col.key === 'bestScore' ? 'text-right' : 'text-center'
                      } ${sortKey === col.key ? 'text-gold-200' : ''}`}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </button>
                  ))}
                </div>
                {sortedPlayers.map((p, i) => {
                  const gp = p.gamesPlayed ?? 0;
                  const avg = gp > 0 ? Math.round((p.totalScore ?? 0) / gp) : 0;
                  const winRate =
                    gp > 0 ? Math.round(((p.wins ?? 0) / gp) * 100) : 0;
                  const medal = i < 3 ? MEDAL_EMOJIS[i] : null;
                  const hasAliases = (p.aliases ?? []).length > 0;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setMergeError(null);
                        setDetail({ mode: 'view', player: p });
                      }}
                      className={`w-full text-left ${STATS_GRID} px-3 py-2.5 border-b border-gold-700/20 last:border-0 active:bg-navy-700/40 ${
                        i === 0 ? 'bg-gold-300/8' : ''
                      }`}
                    >
                      <span
                        className={`text-sm font-bold ${
                          i === 0 ? 'text-gold-200' : 'text-navy-200'
                        }`}
                      >
                        {medal || `${i + 1}.`}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-white font-medium text-sm truncate min-w-0">
                            {p.name}
                          </span>
                          {hasAliases && (
                            <span
                              aria-label={`also known as ${p.aliases!.join(', ')}`}
                              title={`Also: ${p.aliases!.join(', ')}`}
                              className="shrink-0 text-[9px] leading-none px-1 py-0.5 rounded-full bg-navy-700/80 border border-gold-700/40 text-gold-200 font-normal tabular-nums"
                            >
                              ⓘ {p.aliases!.length}
                            </span>
                          )}
                        </div>
                        {(p.totalShamePoints ?? 0) > 0 && (
                          <span className="text-rose-400 text-[10px] block">
                            💀 {p.totalShamePoints}
                          </span>
                        )}
                      </div>
                      <span className="text-center text-gold-100 text-sm font-semibold tabular-nums">
                        {winRate}%
                      </span>
                      <span className="text-center text-emerald-400 text-sm font-semibold tabular-nums">
                        {p.wins ?? 0}
                      </span>
                      <span className="text-center text-navy-200 text-sm tabular-nums">
                        {gp}
                      </span>
                      <span
                        className={`text-center text-sm font-medium tabular-nums ${
                          avg > 0
                            ? 'text-emerald-400'
                            : avg < 0
                              ? 'text-rose-400'
                              : 'text-navy-200'
                        }`}
                      >
                        {avg}
                      </span>
                      <span className="text-right text-gold-200 text-sm font-medium tabular-nums">
                        {p.bestScore ?? '—'}
                      </span>
                    </button>
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
                    <button
                      type="button"
                      key={game.id}
                      onClick={() => {
                        setGameDeleteError(null);
                        setGameDetail({ mode: 'view', game });
                      }}
                      className="w-full text-left card-gold p-3 active:bg-navy-700/30 transition-colors"
                    >
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
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {detail && (
          <PlayerDetailOverlay
            state={detail}
            visiblePlayers={visiblePlayers}
            mergeError={mergeError}
            onClose={() => {
              setDetail(null);
              setMergeError(null);
            }}
            onStartMerge={() =>
              detail.mode === 'view'
                ? setDetail({ mode: 'pickMergeTarget', player: detail.player })
                : undefined
            }
            onPickTarget={(target) =>
              detail.mode === 'pickMergeTarget'
                ? setDetail({
                    mode: 'confirmMerge',
                    alias: detail.player,
                    canonical: target,
                  })
                : undefined
            }
            onConfirmMerge={() =>
              detail.mode === 'confirmMerge'
                ? applyMerge(detail.canonical, detail.alias)
                : undefined
            }
            onBackToView={() => {
              if (detail.mode === 'pickMergeTarget') {
                setDetail({ mode: 'view', player: detail.player });
              } else if (detail.mode === 'confirmMerge') {
                setDetail({
                  mode: 'pickMergeTarget',
                  player: detail.alias,
                });
              }
            }}
          />
        )}

        {gameDetail && (
          <GameDetailOverlay
            state={gameDetail}
            deleteError={gameDeleteError}
            onClose={() => {
              setGameDetail(null);
              setGameDeleteError(null);
            }}
            onStartDelete={() => {
              if (gameDetail.mode === 'view') {
                setGameDeleteError(null);
                setGameDetail({ mode: 'confirmDelete', game: gameDetail.game });
              }
            }}
            onCancelDelete={() => {
              if (gameDetail.mode === 'confirmDelete') {
                setGameDetail({ mode: 'view', game: gameDetail.game });
              }
            }}
            onConfirmDelete={async () => {
              if (gameDetail.mode !== 'confirmDelete') return;
              const targetId = gameDetail.game.id;
              setGameDeleteError(null);
              setGameDetail({ mode: 'deleting', game: gameDetail.game });
              try {
                await deleteHistoryGame(targetId);
                setGames((prev) =>
                  (prev ?? []).filter((g) => g.id !== targetId),
                );
                await loadPlayers();
                setGameDetail(null);
              } catch (err) {
                setGameDeleteError(
                  err instanceof Error ? err.message : 'Delete failed.',
                );
                setGameDetail({
                  mode: 'confirmDelete',
                  game: gameDetail.game,
                });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

type OverlayProps = {
  state: DetailState;
  visiblePlayers: PlayerRow[];
  mergeError: string | null;
  onClose: () => void;
  onStartMerge: () => void;
  onPickTarget: (target: PlayerRow) => void;
  onConfirmMerge: () => void;
  onBackToView: () => void;
};

function PlayerDetailOverlay({
  state,
  visiblePlayers,
  mergeError,
  onClose,
  onStartMerge,
  onPickTarget,
  onConfirmMerge,
  onBackToView,
}: OverlayProps) {
  const isMerging = state.mode === 'merging';
  return (
    <div
      className="fixed inset-0 z-50 bg-navy-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
      onClick={isMerging ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md card-gold p-4 space-y-3 max-h-[80vh] overflow-y-auto"
      >
        {(state.mode === 'view' || state.mode === 'pickMergeTarget') && (
          <PlayerDetailHeader
            player={state.player}
            subtitle={
              state.mode === 'pickMergeTarget'
                ? 'Pick the player to merge this INTO'
                : null
            }
            onBack={state.mode === 'pickMergeTarget' ? onBackToView : null}
            onClose={onClose}
          />
        )}

        {(state.mode === 'confirmMerge' || state.mode === 'merging') && (
          <PlayerDetailHeader
            player={state.alias}
            subtitle="Confirm merge"
            onBack={isMerging ? null : onBackToView}
            onClose={isMerging ? null : onClose}
          />
        )}

        {state.mode === 'view' && (
          <ViewBody player={state.player} onStartMerge={onStartMerge} />
        )}

        {state.mode === 'pickMergeTarget' && (
          <PickBody
            self={state.player}
            visiblePlayers={visiblePlayers}
            onPick={onPickTarget}
          />
        )}

        {(state.mode === 'confirmMerge' || state.mode === 'merging') && (
          <ConfirmBody
            alias={state.alias}
            canonical={state.canonical}
            mergeError={mergeError}
            isMerging={isMerging}
            onConfirm={onConfirmMerge}
            onCancel={onBackToView}
          />
        )}
      </div>
    </div>
  );
}

function PlayerDetailHeader({
  player,
  subtitle,
  onBack,
  onClose,
}: {
  player: PlayerRow;
  subtitle: string | null;
  onBack: (() => void) | null;
  onClose: (() => void) | null;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-gold-200 text-base font-bold truncate">
          {player.name}
        </p>
        {subtitle && (
          <p className="text-navy-200 text-xs uppercase tracking-wider mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-navy-200 text-xs underline underline-offset-2"
          >
            ← back
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-navy-200 text-sm px-2 py-0.5 rounded hover:bg-navy-700/60"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function ViewBody({
  player,
  onStartMerge,
}: {
  player: PlayerRow;
  onStartMerge: () => void;
}) {
  const gp = player.gamesPlayed ?? 0;
  const aliases = player.aliases ?? [];
  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="GP" value={gp} />
        <Stat label="Wins" value={player.wins ?? 0} />
        <Stat
          label="Win%"
          value={gp > 0 ? `${Math.round(((player.wins ?? 0) / gp) * 100)}%` : '—'}
        />
        <Stat
          label="Total"
          value={(player.totalScore ?? 0).toString()}
        />
        <Stat label="Best" value={player.bestScore ?? '—'} />
        <Stat
          label="Avg"
          value={gp > 0 ? Math.round((player.totalScore ?? 0) / gp) : '—'}
        />
      </div>
      <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-2.5">
        <p className="text-xs uppercase tracking-wider text-navy-200 mb-1">
          Also known as
        </p>
        {aliases.length === 0 ? (
          <p className="text-navy-300 text-xs italic">
            No aliases. Tap "Merge into…" if this player is the same as
            another listed name.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {aliases.map((a) => (
              <li key={a} className="text-sm text-navy-50">
                • {a}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onStartMerge}
        className="w-full rounded-lg py-2.5 text-sm font-semibold bg-navy-800 border border-gold-700/60 text-gold-200 active:scale-[0.99]"
      >
        Merge {player.name} into another player…
      </button>
    </>
  );
}

function PickBody({
  self,
  visiblePlayers,
  onPick,
}: {
  self: PlayerRow;
  visiblePlayers: PlayerRow[];
  onPick: (target: PlayerRow) => void;
}) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const choices = visiblePlayers
    .filter((p) => p.id !== self.id)
    .filter((p) => !f || p.name.toLowerCase().includes(f))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <p className="text-xs text-navy-200">
        Stats from <span className="text-gold-100">{self.name}</span> will
        be folded into the player you pick, and{' '}
        <span className="text-gold-100">{self.name}</span> will be hidden
        from this list.
      </p>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search players…"
        className="w-full rounded-md bg-navy-800 border border-gold-700/60 px-2.5 py-1.5 text-sm text-navy-50 placeholder:text-navy-300 focus:outline-none focus:border-gold-400"
      />
      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-gold-700/30 divide-y divide-gold-700/20">
        {choices.length === 0 ? (
          <p className="text-navy-300 text-xs italic p-3 text-center">
            No matching players.
          </p>
        ) : (
          choices.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="w-full text-left px-3 py-2 active:bg-navy-700/60 flex items-center justify-between gap-2"
            >
              <span className="text-sm text-navy-50 truncate">{p.name}</span>
              <span className="text-[11px] text-navy-300 tabular-nums shrink-0">
                {p.gamesPlayed ?? 0} GP
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function ConfirmBody({
  alias,
  canonical,
  mergeError,
  isMerging,
  onConfirm,
  onCancel,
}: {
  alias: PlayerRow;
  canonical: PlayerRow;
  mergeError: string | null;
  isMerging: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-3 space-y-2 text-sm">
        <p className="text-navy-50">
          Merge <span className="text-gold-100 font-bold">{alias.name}</span>{' '}
          INTO{' '}
          <span className="text-gold-100 font-bold">{canonical.name}</span>?
        </p>
        <ul className="text-xs text-navy-200 space-y-1">
          <li>• Stats from both rows are summed onto {canonical.name}.</li>
          <li>
            • {alias.name} will be hidden from the All-Time Stats list.
          </li>
          <li>
            • Past games keep the original names. Use the script to
            unmerge.
          </li>
        </ul>
      </div>
      {mergeError && (
        <p className="text-rose-300 text-sm text-center">{mergeError}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isMerging}
          className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-navy-800 border border-gold-700/60 text-navy-100 active:scale-[0.99] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isMerging}
          className="flex-1 rounded-lg py-2.5 text-sm font-semibold btn-gold border border-gold-400 active:scale-[0.99] disabled:opacity-50"
        >
          {isMerging ? 'Merging…' : `Merge into ${canonical.name}`}
        </button>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-navy-900/50 border border-gold-700/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-navy-300 leading-none">
        {label}
      </p>
      <p className="text-sm font-bold text-gold-100 tabular-nums leading-tight mt-1">
        {value}
      </p>
    </div>
  );
}

function formatDateLong(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type GameDetailProps = {
  state: GameDetail;
  deleteError: string | null;
  onClose: () => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function GameDetailOverlay({
  state,
  deleteError,
  onClose,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: GameDetailProps) {
  const isDeleting = state.mode === 'deleting';
  const game = state.game;
  const sortedResults = [...(game.results ?? [])].sort(
    (a, b) => a.rank - b.rank,
  );
  const breakdown: GameRoundBreakdown[] = game.log
    ? roundBreakdownFromLog(game.log)
    : [];

  // ScoreLineGraph reads only `log` + `playerOrder` off its room prop.
  // Use seat order from the log's first `deal` entry when available
  // (preserves the colors that were assigned during play), otherwise
  // fall back to results order.
  const playerOrder = (() => {
    const dealPlayers: string[] = [];
    if (game.log) {
      const seen = new Set<string>();
      for (const e of game.log) {
        if (e.t === 'bid' && !seen.has(e.player)) {
          dealPlayers.push(e.player);
          seen.add(e.player);
        }
        if (dealPlayers.length === game.playerCount) break;
      }
    }
    if (dealPlayers.length === game.playerCount) return dealPlayers;
    return sortedResults.map((r) => r.name);
  })();
  const fakeRoom = {
    log: game.log ?? [],
    playerOrder,
  } as unknown as RoomDoc;

  return (
    <div
      className="fixed inset-0 z-50 bg-navy-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
      onClick={isDeleting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md card-gold p-4 space-y-3 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-gold-200 text-base font-bold leading-tight">
              {formatDateLong(game.date)}
            </p>
            <p className="text-navy-200 text-xs mt-0.5">
              {game.roundCount} round{game.roundCount !== 1 ? 's' : ''} ·{' '}
              {game.playerCount} player{game.playerCount !== 1 ? 's' : ''}
            </p>
          </div>
          {!isDeleting && (
            <button
              type="button"
              onClick={onClose}
              className="text-navy-200 text-sm px-2 py-0.5 rounded hover:bg-navy-700/60"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        {breakdown.length > 0 && (
          <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-2">
            <ScoreLineGraph room={fakeRoom} autoStartDelayMs={400} />
          </div>
        )}

        <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-2.5">
          <p className="text-xs uppercase tracking-wider text-navy-200 mb-1.5">
            Final standings
          </p>
          <div className="space-y-1">
            {sortedResults.map((r, ri) => {
              const medal = ri < 3 ? MEDAL_EMOJIS[ri] : null;
              return (
                <div
                  key={`${r.playerId ?? r.name}-${ri}`}
                  className="flex items-center justify-between text-sm"
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
                      className={`truncate ${
                        ri === 0 ? 'text-white font-medium' : 'text-gray-300'
                      }`}
                    >
                      {r.name}
                    </span>
                  </div>
                  <span
                    className={`font-semibold tabular-nums ${
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

        {breakdown.length > 0 && (
          <RoundBreakdownTable
            breakdown={breakdown}
            playerOrder={playerOrder}
          />
        )}

        {breakdown.length === 0 && (
          <p className="text-navy-300 text-xs italic text-center">
            No round-by-round data was stored for this game.
          </p>
        )}

        <div className="pt-1 border-t border-gold-700/30">
          {state.mode === 'view' && (
            <button
              type="button"
              onClick={onStartDelete}
              className="w-full rounded-lg py-2.5 text-sm font-semibold bg-navy-900 border border-rose-700/60 text-rose-200 active:scale-[0.99]"
            >
              Delete this game…
            </button>
          )}

          {(state.mode === 'confirmDelete' || isDeleting) && (
            <div className="space-y-2">
              <p className="text-sm text-rose-100">
                Delete this game permanently?
              </p>
              <ul className="text-xs text-navy-200 space-y-0.5">
                <li>• The game disappears from Past Games.</li>
                <li>
                  • Each player's GP, wins, and total score roll back by
                  this game's contribution.
                </li>
                <li>
                  • Best/worst score columns are NOT recomputed — they
                  may show a slightly stale value until the affected
                  player finishes another game.
                </li>
              </ul>
              {deleteError && (
                <p className="text-rose-300 text-sm text-center">
                  {deleteError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-navy-800 border border-gold-700/60 text-navy-100 active:scale-[0.99] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-rose-700/60 border border-rose-500/70 text-white active:scale-[0.99] disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundBreakdownTable({
  breakdown,
  playerOrder,
}: {
  breakdown: GameRoundBreakdown[];
  playerOrder: string[];
}) {
  // Running cumulative per player as we walk through rounds.
  const cumulative: Record<string, number> = {};
  for (const n of playerOrder) cumulative[n] = 0;
  return (
    <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-2.5">
      <p className="text-xs uppercase tracking-wider text-navy-200 mb-1.5">
        Round-by-round
      </p>
      <div className="overflow-x-auto -mx-0.5">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="text-navy-300">
              <th className="text-left font-normal pr-1 sticky left-0 bg-navy-900/50 z-10">
                R
              </th>
              {playerOrder.map((n) => (
                <th
                  key={n}
                  className="font-normal px-1 text-right truncate max-w-[60px]"
                  title={n}
                >
                  {n.length > 6 ? `${n.slice(0, 5)}…` : n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {breakdown.map((r) => {
              for (const n of playerOrder) {
                cumulative[n] =
                  (cumulative[n] ?? 0) + (r.deltas[n] ?? 0);
              }
              return (
                <tr
                  key={r.round}
                  className="border-t border-gold-700/15 align-top"
                >
                  <td className="pr-1 text-gold-200 sticky left-0 bg-navy-900/50 z-10 py-1">
                    {r.round}
                  </td>
                  {playerOrder.map((n) => {
                    const bid = r.bids[n];
                    const won = r.tricks[n] ?? 0;
                    const delta = r.deltas[n] ?? 0;
                    const total = cumulative[n] ?? 0;
                    const hit = bid !== undefined && bid === won;
                    return (
                      <td
                        key={n}
                        className="px-1 text-right py-1 leading-tight"
                      >
                        <div
                          className={`text-[11px] ${
                            hit ? 'text-emerald-300' : 'text-navy-100'
                          }`}
                        >
                          {bid !== undefined ? `${won}/${bid}` : '—'}
                        </div>
                        <div
                          className={`text-[10px] ${
                            delta > 0
                              ? 'text-emerald-400'
                              : delta < 0
                                ? 'text-rose-400'
                                : 'text-navy-300'
                          }`}
                        >
                          {delta > 0 ? '+' : ''}
                          {delta}
                        </div>
                        <div className="text-[10px] text-gold-200">{total}</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-navy-300 mt-1.5">
        Each cell: won/bid · Δ · running total
      </p>
    </div>
  );
}
