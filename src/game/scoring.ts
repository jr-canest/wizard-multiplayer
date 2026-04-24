/**
 * Wizard scoring (matches the scorekeeper):
 *   - Exact bid:    +20 + 10 * bid       (so 0/0 = 20, 1/1 = 30, ...)
 *   - Missed bid:   -10 * |bid - won|
 */
export function calcRoundScore(bid: number, won: number): number {
  if (bid === won) return 20 + 10 * bid;
  return -10 * Math.abs(bid - won);
}
