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

type GameDoc = {
  date: Timestamp | null;
  roundCount: number;
  playerCount: number;
  results: Array<{
    name: string;
    score: number;
    rank: number;
  }>;
  source?: string;
};

type GameRow = GameDoc & { id: string };

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
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

  if (games === null) {
    return (
      <div className="card-gold-subtle px-4 py-3 text-center text-xs text-navy-300">
        Loading recent games…
      </div>
    );
  }
  if (games.length === 0) return null;

  return (
    <div className="card-gold-subtle p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-navy-200">
          Recent games
        </span>
        <span className="text-[10px] text-navy-400">last {games.length}</span>
      </div>
      <ul className="space-y-1.5">
        {games.map((g) => {
          const winner =
            g.results.find((r) => r.rank === 1) ?? g.results[0];
          const date = formatDate(g.date);
          return (
            <li
              key={g.id}
              className="flex items-center justify-between gap-2 text-sm bg-navy-900/40 rounded-md px-2.5 py-1.5"
            >
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="text-gold-200 truncate font-semibold">
                  {winner?.name ?? '—'}
                </span>
                <span className="text-navy-300 text-xs">won</span>
                <span className="text-emerald-300 tabular-nums text-xs font-bold">
                  {winner?.score ?? 0}
                </span>
              </span>
              <span className="flex items-baseline gap-2 text-[11px] text-navy-300 whitespace-nowrap">
                <span>{g.playerCount}p</span>
                <span>·</span>
                <span>{g.roundCount}r</span>
                {date && (
                  <>
                    <span>·</span>
                    <span>{date}</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
