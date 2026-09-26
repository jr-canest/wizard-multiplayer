import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSession } from '../hooks/useSession';
import { CardImage } from '../components/CardImage';
import {
  renamePlayer,
  setAliases as setAliasesRemote,
  isValidPlayerName,
  type PlayerDoc,
} from '../lib/players';
import {
  computePlayerStats,
  type PlayerStats,
} from '../lib/playerStats';
import { cardLabel } from '../lib/cardImages';
import {
  fetchReactionTallies,
  type ReactionTally,
} from '../lib/reactions';
import type { LogEntry } from '../lib/types';

type GameDoc = {
  log?: LogEntry[];
  results?: Array<{ name: string; bot?: string }>;
};

const SUIT_GLYPH: Record<'H' | 'D' | 'C' | 'S', string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

export function Me() {
  const navigate = useNavigate();
  const { session, clearSession } = useSession();
  const [player, setPlayer] = useState<PlayerDoc | null>(null);
  const [games, setGames] = useState<GameDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    // Resets are deliberate so re-running the effect (e.g. after a
    // session switch) shows a fresh loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setPlayer(null);
    setGames(null);
    let cancelled = false;
    (async () => {
      try {
        const [pSnap, gSnap] = await Promise.all([
          getDoc(doc(db, 'players', session.playerId)),
          getDocs(
            query(collection(db, 'games'), orderBy('date', 'desc'), limit(500)),
          ),
        ]);
        if (cancelled) return;
        if (!pSnap.exists()) {
          setError('Your player record was not found.');
          return;
        }
        setPlayer({
          id: pSnap.id,
          ...(pSnap.data() as Omit<PlayerDoc, 'id'>),
        });
        setGames(gSnap.docs.map((d) => d.data() as GameDoc));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load stats.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const names = useMemo(() => {
    if (!player) return [];
    return [player.name, ...(player.aliases ?? [])];
  }, [player]);

  const stats: PlayerStats | null = useMemo(() => {
    if (!player || !games) return null;
    // Cap to games this player appears in — saves walking unrelated logs.
    const nameSet = new Set(names.map((n) => n.toLowerCase()));
    const mine = games.filter((g) =>
      (g.results ?? []).some((r) => !r.bot && nameSet.has(r.name.toLowerCase())),
    );
    return computePlayerStats(mine, names);
  }, [player, games, names]);

  if (!session) {
    return (
      <div className="min-h-screen-z px-4 pt-6 pb-10 flex items-center justify-center">
        <div className="card-gold p-6 max-w-sm text-center space-y-3">
          <p className="font-display font-semibold text-[20px] text-cream-bright">Sign in to see your stats</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="btn-gold h-10 px-4 text-sm"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  const loading = !error && (player === null || games === null);

  return (
    <div className="min-h-screen-z px-4 pt-6 pb-10">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">My stats</div>
            <h1 className="font-display font-semibold text-[28px] leading-none text-cream-bright truncate">
              {player?.name ?? session.playerName}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-navy-200 text-sm underline underline-offset-2"
          >
            ← Home
          </button>
        </div>

        {loading && (
          <p className="text-navy-200 text-sm text-center py-12">
            Loading your stats…
          </p>
        )}

        {error && (
          <p className="text-rose-300 text-sm text-center py-12">{error}</p>
        )}

        {player && stats && (
          <>
            <AggregateHeader player={player} stats={stats} />
            <TopCardsSection stats={stats} />
            <BidAccuracySection stats={stats} />
            <TrickStatsSection stats={stats} />
            <ReactionUseSection />
            <IdentityEditSection
              player={player}
              onChanged={(next) => setPlayer(next)}
            />
            <button
              type="button"
              onClick={() => {
                clearSession();
                navigate('/');
              }}
              className="btn-secondary w-full py-2.5 text-sm"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AggregateHeader({
  player,
  stats,
}: {
  player: PlayerDoc;
  stats: PlayerStats;
}) {
  const gp = player.gamesPlayed ?? 0;
  const wins = player.wins ?? 0;
  const totalScore = player.totalScore ?? 0;
  return (
    <div className="card-gold p-3 space-y-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="GP" value={gp} />
        <Stat label="Wins" value={wins} />
        <Stat label="Win%" value={pct(wins, gp)} />
        <Stat label="Total" value={totalScore} />
        <Stat label="Best" value={player.bestScore ?? '—'} />
        <Stat
          label="Avg"
          value={gp > 0 ? Math.round(totalScore / gp) : '—'}
        />
      </div>
      <p className="text-[10px] text-navy-300 text-center">
        Trick-level stats from {stats.gamesWithLog} logged game
        {stats.gamesWithLog === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function TopCardsSection({ stats }: { stats: PlayerStats }) {
  const cards = stats.topWinningCards;
  return (
    <div className="card-gold p-3 space-y-2">
      <p className="section-label">
        Top winning cards
      </p>
      {cards.length === 0 ? (
        <p className="text-navy-300 text-xs italic">
          No trick-level data yet — play (and win) a few tricks.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
          {cards.map((c) => (
            <div
              key={c.key}
              className="shrink-0 flex flex-col items-center gap-1"
            >
              <CardImage card={c.card} size="sm" />
              <div className="text-[10px] text-gold-text font-bold tabular-nums leading-none">
                {c.count}×
              </div>
              <div className="text-[9px] text-navy-300 leading-none">
                {cardLabel(c.card)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BidAccuracySection({ stats }: { stats: PlayerStats }) {
  const b = stats.bidStats;
  return (
    <div className="card-gold p-3 space-y-2">
      <p className="section-label">
        Bid accuracy
      </p>
      {b.rounds === 0 ? (
        <p className="text-navy-300 text-xs italic">
          No round-level bid data yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Exact" value={pct(b.exact, b.rounds)} />
            <Stat label="Over" value={pct(b.over, b.rounds)} />
            <Stat label="Under" value={pct(b.under, b.rounds)} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <Stat
              label="Zero-bid hit"
              value={
                b.zeroBidsAttempted > 0
                  ? `${pct(b.zeroBidsHit, b.zeroBidsAttempted)} (${b.zeroBidsHit}/${b.zeroBidsAttempted})`
                  : '—'
              }
            />
            <Stat label="Rounds" value={b.rounds} />
          </div>
          {b.byHandSize.length > 0 && (
            <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-2 mt-1">
              <p className="section-label mb-1.5">
                Exact-bid % by hand size
              </p>
              <div className="space-y-0.5">
                {b.byHandSize.map((row) => (
                  <div
                    key={row.bucket}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-navy-100">{row.bucket} card{row.bucket === '1' ? '' : 's'}</span>
                    <span className="text-cream font-semibold tabular-nums">
                      {pct(row.exact, row.rounds)} ({row.exact}/{row.rounds})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrickStatsSection({ stats }: { stats: PlayerStats }) {
  const t = stats.trickStats;
  const standardWins =
    t.winsBySuit.H + t.winsBySuit.D + t.winsBySuit.C + t.winsBySuit.S;
  return (
    <div className="card-gold p-3 space-y-2">
      <p className="section-label">
        Trick play
      </p>
      {t.totalTricksPlayed === 0 ? (
        <p className="text-navy-300 text-xs italic">
          No trick play data yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat
              label="Win rate"
              value={pct(t.totalTricksWon, t.totalTricksPlayed)}
            />
            <Stat
              label="Lead win%"
              value={pct(t.asLead.won, t.asLead.tricks)}
            />
            <Stat
              label="Follow win%"
              value={pct(t.asFollow.won, t.asFollow.tricks)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Tricks won" value={t.totalTricksWon} />
            <Stat label="🧙 Wizards" value={t.wizardWins} />
            <Stat label="🃏 Jesters" value={t.jesterWins} />
          </div>
          {standardWins > 0 && (
            <div className="rounded-md bg-navy-900/50 border border-gold-700/30 p-2 mt-1">
              <p className="section-label mb-1.5">
                Standard-card wins by suit
              </p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {(['H', 'D', 'C', 'S'] as const).map((suit) => (
                  <div key={suit} className="flex flex-col items-center">
                    <span
                      className={`text-base ${
                        suit === 'H' || suit === 'D'
                          ? 'text-rose-400'
                          : 'text-navy-100'
                      }`}
                    >
                      {SUIT_GLYPH[suit]}
                    </span>
                    <span className="text-xs text-cream font-semibold tabular-nums">
                      {t.winsBySuit[suit]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Which reaction phrases the table actually reaches for, counted across
 * every room (see src/lib/reactions.ts). Most used at the top, never
 * used at the bottom, so retiring a dead phrase is an easy call.
 */
function ReactionUseSection() {
  const [tallies, setTallies] = useState<ReactionTally[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchReactionTallies()
      .then((rows) => {
        if (alive) setTallies(rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const total = (tallies ?? []).reduce((a, r) => a + r.count, 0);
  const top = total > 0 ? Math.max(...(tallies ?? []).map((r) => r.count)) : 0;

  return (
    <div className="card-gold p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="section-label">Reactions used</p>
        {total > 0 && (
          <span className="text-[10px] text-navy-300 tabular-nums">
            {total} sent
          </span>
        )}
      </div>
      {failed ? (
        <p className="text-navy-300 text-xs italic">
          Could not load reaction counts.
        </p>
      ) : tallies === null ? (
        <p className="text-navy-300 text-xs italic">Loading…</p>
      ) : total === 0 ? (
        <p className="text-navy-300 text-xs italic">
          No reactions sent yet.
        </p>
      ) : (
        <div className="space-y-1">
          {tallies.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <span
                className={`text-xs truncate ${
                  r.count === 0 ? 'text-navy-400' : 'text-cream'
                }`}
              >
                {r.text}
                {r.retired && (
                  <span className="ml-1 text-[9px] uppercase tracking-wider text-navy-400">
                    retired
                  </span>
                )}
              </span>
              <span className="flex-1 h-[6px] rounded-full bg-navy-900/70 overflow-hidden">
                <span
                  className="block h-full rounded-full bg-gold-300/70"
                  style={{
                    width: top > 0 ? `${(r.count / top) * 100}%` : '0%',
                  }}
                />
              </span>
              <span className="text-xs text-cream font-semibold tabular-nums w-7 text-right">
                {r.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  // Square-ish tiles: a min-height + centered stack keeps them from
  // rendering as wide, stretched-looking bars (most noticeable on the
  // larger iPad/desktop zoom). Mirrors the scorekeeper's Stat tile.
  return (
    <div className="rounded-md bg-navy-900/50 border border-gold-700/30 px-2 py-2.5 min-h-[3.25rem] flex flex-col items-center justify-center gap-1.5">
      <p className="section-label">{label}</p>
      <p className="font-bold text-[16px] text-cream tabular-nums leading-none">
        {value}
      </p>
    </div>
  );
}

type EditMode = 'closed' | 'open';

function IdentityEditSection({
  player,
  onChanged,
}: {
  player: PlayerDoc;
  onChanged: (next: PlayerDoc) => void;
}) {
  const [mode, setMode] = useState<EditMode>('closed');
  const [name, setName] = useState(player.name);
  const [aliasInput, setAliasInput] = useState('');
  const [aliases, setAliases] = useState<string[]>(player.aliases ?? []);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    | { kind: 'error'; text: string }
    | { kind: 'success'; text: string }
    | null
  >(null);

  function openEditor() {
    setName(player.name);
    setAliases(player.aliases ?? []);
    setAliasInput('');
    setPin('');
    setMessage(null);
    setMode('open');
  }

  function close() {
    setMode('closed');
    setMessage(null);
  }

  function addAliasFromInput() {
    const trimmed = aliasInput.trim();
    if (!trimmed) return;
    if (!isValidPlayerName(trimmed)) {
      setMessage({
        kind: 'error',
        text: 'Alias must be 1–20 characters.',
      });
      return;
    }
    const lower = trimmed.toLowerCase();
    if (lower === player.name.trim().toLowerCase()) {
      setMessage({
        kind: 'error',
        text: 'Alias matches your current name.',
      });
      return;
    }
    if (aliases.some((a) => a.toLowerCase() === lower)) {
      setAliasInput('');
      return;
    }
    setAliases([...aliases, trimmed]);
    setAliasInput('');
    setMessage(null);
  }

  function removeAlias(a: string) {
    setAliases(aliases.filter((x) => x !== a));
  }

  async function save() {
    if (saving) return;
    if (!/^\d{4}$/.test(pin)) {
      setMessage({ kind: 'error', text: 'Enter your 4-digit PIN.' });
      return;
    }
    setSaving(true);
    setMessage(null);

    const trimmedName = name.trim();
    const nameChanged =
      trimmedName.toLowerCase() !== player.name.trim().toLowerCase() ||
      trimmedName !== player.name;
    const currentAliases = player.aliases ?? [];
    const aliasesChanged =
      currentAliases.length !== aliases.length ||
      currentAliases.some((a, i) => a !== aliases[i]);

    try {
      if (nameChanged) {
        const r = await renamePlayer(player.id, trimmedName, pin);
        if (!r.ok) {
          setSaving(false);
          setMessage({
            kind: 'error',
            text:
              r.reason === 'wrongPin'
                ? 'PIN does not match.'
                : r.reason === 'nameTaken'
                  ? 'That name is taken by another player.'
                  : r.reason === 'invalidName'
                    ? 'Name must be 1–20 characters.'
                    : 'Could not save.',
          });
          return;
        }
      }
      if (aliasesChanged) {
        const r = await setAliasesRemote(player.id, aliases, pin);
        if (!r.ok) {
          setSaving(false);
          setMessage({
            kind: 'error',
            text:
              r.reason === 'wrongPin'
                ? 'PIN does not match.'
                : 'Could not save aliases.',
          });
          return;
        }
      }
      onChanged({
        ...player,
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        aliases,
      });
      setMessage({ kind: 'success', text: 'Saved.' });
      setPin('');
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not save.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'closed') {
    return (
      <div className="card-gold p-3 space-y-2">
        <p className="section-label">
          Name & aliases
        </p>
        <div className="text-sm text-navy-50">
          <span className="font-display font-semibold text-[16px] text-cream-bright">{player.name}</span>
          {(player.aliases ?? []).length > 0 && (
            <span className="text-navy-200">
              {' '}
              · also{' '}
              {(player.aliases ?? []).map((a, i) => (
                <span key={a}>
                  {i > 0 ? ', ' : ''}
                  <span className="text-navy-100">{a}</span>
                </span>
              ))}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={openEditor}
          className="btn-secondary w-full py-2 text-sm"
        >
          Edit name & aliases
        </button>
      </div>
    );
  }

  return (
    <div className="card-gold p-3 space-y-3">
      <div className="flex items-start justify-between">
        <p className="section-label">
          Edit name & aliases
        </p>
        <button
          type="button"
          onClick={close}
          disabled={saving}
          className="text-navy-200 text-xs underline underline-offset-2 disabled:opacity-50"
        >
          cancel
        </button>
      </div>

      <label className="block">
        <span className="section-label block mb-1.5">
          Display name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          className="w-full rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-2.5 py-1.5 text-sm text-cream focus:border-gold-300 focus:outline-none"
          placeholder="Your name"
        />
      </label>

      <div>
        <span className="section-label block mb-1.5">
          Aliases (past names that should count as you)
        </span>
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {aliases.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(20,26,44,.8)] border border-gold-300/25 text-xs text-cream"
              >
                {a}
                <button
                  type="button"
                  onClick={() => removeAlias(a)}
                  className="text-navy-300 hover:text-rose-300"
                  aria-label={`Remove alias ${a}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAliasFromInput();
              }
            }}
            maxLength={20}
            className="flex-1 min-w-0 rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-2.5 py-1.5 text-sm text-cream focus:border-gold-300 focus:outline-none"
            placeholder="Add alias…"
          />
          <button
            type="button"
            onClick={addAliasFromInput}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            Add
          </button>
        </div>
        <p className="text-[10px] text-navy-300 mt-1">
          Past games keep their recorded names — adding an alias rolls those
          games into your stats.
        </p>
      </div>

      <label className="block">
        <span className="section-label block mb-1.5">
          Confirm with your PIN
        </span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          maxLength={4}
          className="w-full rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-2.5 py-1.5 text-lg tracking-[0.5em] text-center text-cream tabular-nums focus:border-gold-300 focus:outline-none"
          placeholder="• • • •"
        />
      </label>

      {message && (
        <p
          className={`text-xs text-center ${
            message.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="btn-gold w-full py-2.5 text-sm active:scale-[0.99] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
