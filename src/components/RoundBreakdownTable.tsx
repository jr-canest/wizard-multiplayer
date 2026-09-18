import type { GameRoundBreakdown } from '../lib/history';

/**
 * Round-by-round table: one row per round, one column per player, each
 * cell won/bid over the round delta over the running total. Shared by the
 * History game detail and the end-of-game FinalScoreboard, and kept in
 * lockstep with the scorekeeper's RoundBreakdownTable (parity rule).
 */
export function RoundBreakdownTable({
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
      <p className="section-label mb-1.5">
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
                  <td className="pr-1 text-gold-text font-semibold text-[11px] tabular-nums sticky left-0 bg-navy-900/50 z-10 py-1">
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
                        <div className="text-[10px] text-gold-text font-semibold tabular-nums">{total}</div>
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
