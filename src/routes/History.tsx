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
  aliases?: string[];
  mergedInto?: string;
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
                  const hasAliases = (p.aliases ?? []).length > 0;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setMergeError(null);
                        setDetail({ mode: 'view', player: p });
                      }}
                      className={`w-full text-left flex items-center px-3 py-2.5 border-b border-gold-700/20 last:border-0 active:bg-navy-700/40 ${
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
                        <span className="text-white font-medium text-sm truncate inline-flex items-center gap-1">
                          {p.name}
                          {hasAliases && (
                            <span
                              aria-label={`also known as ${p.aliases!.join(', ')}`}
                              title={`Also: ${p.aliases!.join(', ')}`}
                              className="text-[10px] leading-none px-1 py-0.5 rounded-full bg-navy-700/80 border border-gold-700/40 text-gold-200 font-normal"
                            >
                              ⓘ {p.aliases!.length}
                            </span>
                          )}
                        </span>
                        {(p.totalShamePoints ?? 0) > 0 && (
                          <span className="text-rose-400 text-[10px] block">
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
