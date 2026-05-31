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
import type { LogEntry } from '../lib/types';

type GameDoc = {
  log?: LogEntry[];
  results?: Array<{ name: string }>;
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
      (g.results ?? []).some((r) => nameSet.has(r.name.toLowerCase())),
    );
    return computePlayerStats(mine, names);
  }, [player, games, names]);

  if (!session) {
    return (
      <div className="min-h-svh px-4 pt-6 pb-10 flex items-center justify-center">
        <div className="card-gold p-6 max-w-sm text-center space-y-3">
          <p className="text-gold-200 font-bold">Sign in to see your stats</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="btn-gold rounded-lg px-4 py-2 text-sm"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  const loading = !error && (player === null || games === null);

  return (
    <div className="min-h-svh px-4 pt-6 pb-10">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gold-200 truncate">
            {player?.name ?? session.playerName}
          </h1>
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
              className="w-full rounded-xl py-2.5 text-sm font-medium text-navy-200 border border-navy-600 active:bg-navy-700/40"
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
      <p className="text-xs uppercase tracking-wider text-navy-200">
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
              <div className="text-[10px] text-gold-200 font-semibold leading-none">
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
      <p className="text-xs uppercase tracking-wider text-navy-200">
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
              <p className="text-[10px] uppercase tracking-wider text-navy-300 mb-1">
                Exact-bid % by hand size
              </p>
              <div className="space-y-0.5">
                {b.byHandSize.map((row) => (
                  <div
                    key={row.bucket}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-navy-100">{row.bucket} card{row.bucket === '1' ? '' : 's'}</span>
                    <span className="text-gold-100 tabular-nums">
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
      <p className="text-xs uppercase tracking-wider text-navy-200">
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
              <p className="text-[10px] uppercase tracking-wider text-navy-300 mb-1">
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
                    <span className="text-xs text-gold-100 tabular-nums">
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
    <div className="rounded-md bg-navy-900/50 border border-gold-700/30 px-2 py-2.5 min-h-[3.25rem] flex flex-col items-center justify-center gap-1">
      <p className="text-[10px] uppercase tracking-wider text-navy-300 leading-none">
        {label}
      </p>
      <p className="text-base font-bold text-gold-100 tabular-nums leading-none">
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
        <p className="text-xs uppercase tracking-wider text-navy-200">
          Name & aliases
        </p>
        <div className="text-sm text-navy-50">
          <span className="text-gold-100">{player.name}</span>
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
          className="w-full rounded-lg py-2 text-sm font-medium bg-navy-800 border border-gold-700/60 text-gold-200 active:scale-[0.99]"
        >
          Edit name & aliases
        </button>
      </div>
    );
  }

  return (
    <div className="card-gold p-3 space-y-3">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-navy-200">
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
        <span className="block text-[11px] uppercase tracking-wider text-navy-200 mb-1">
          Display name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          className="w-full rounded-md bg-navy-800 border border-gold-700/60 px-2.5 py-1.5 text-sm text-navy-50"
          placeholder="Your name"
        />
      </label>

      <div>
        <span className="block text-[11px] uppercase tracking-wider text-navy-200 mb-1">
          Aliases (past names that should count as you)
        </span>
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {aliases.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-navy-800 border border-gold-700/40 text-xs text-navy-50"
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
            className="flex-1 min-w-0 rounded-md bg-navy-800 border border-gold-700/60 px-2.5 py-1.5 text-sm text-navy-50"
            placeholder="Add alias…"
          />
          <button
            type="button"
            onClick={addAliasFromInput}
            className="rounded-md px-3 py-1.5 text-sm font-medium bg-navy-700 border border-gold-700/60 text-gold-100 active:scale-[0.99]"
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
        <span className="block text-[11px] uppercase tracking-wider text-navy-200 mb-1">
          Confirm with your PIN
        </span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          maxLength={4}
          className="w-full rounded-md bg-navy-800 border border-gold-700/60 px-2.5 py-1.5 text-lg font-mono tracking-[0.5em] text-center text-gold-100"
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
        className="w-full rounded-lg py-2.5 text-sm font-semibold btn-gold border border-gold-400 active:scale-[0.99] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
