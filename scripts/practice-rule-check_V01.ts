/**
 * The History rule for games with computer players (Jorge, 2026-11-16):
 * one person vs computers = practice (not saved, not shown, not rated);
 * two or more people with a computer = a real game.
 *   npx tsx scripts/practice-rule-check_V01.ts
 */
import { isSoloComputerGame, computePodiumStats } from '../src/lib/ratings';

// history.ts pulls in Firebase, so the save-side rule is restated here from
// the same definition and checked against the display-side one.
const practice = (order: string[], bots: Record<string, string>) => {
  const computers = order.filter((n) => bots[n]).length;
  return computers > 0 && order.length - computers < 2;
};
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const res = (names: Array<[string, string?]>) => ({
  playerCount: names.length,
  results: names.map(([name, bot], i) => ({ playerId: bot ? '' : `id-${name}`, name, rank: i + 1, ...(bot ? { bot } : {}) })),
});

check(practice(['Jorge', 'Merlin', 'Morgana'], { Merlin: 'expert', Morgana: 'easy' }), 'save: 1 person + 2 computers is practice');
check(!practice(['Jorge', 'Matthias', 'Merlin'], { Merlin: 'expert' }), 'save: 2 people + 1 computer is recorded');
check(!practice(['Jorge', 'Matthias', 'Avi'], {}), 'save: people only is recorded');
check(!practice(['Jorge'], {}), 'save: no computers is never "practice"');

check(isSoloComputerGame(res([['Jorge'], ['Merlin', 'expert'], ['Morgana', 'easy']])), 'show: 1 person + 2 computers hidden');
check(!isSoloComputerGame(res([['Matthias'], ['Merlin', 'expert'], ['Jorge']])), 'show: 2 people + 1 computer shown');
check(!isSoloComputerGame(res([['Jorge'], ['Avi'], ['Manuel']])), 'show: people only shown');
check(!isSoloComputerGame({}), 'show: a game with no results is left alone');

const players = [{ id: 'id-Jorge', name: 'Jorge' }, { id: 'id-Matthias', name: 'Matthias' }];
const podium = computePodiumStats(players as never, [
  res([['Jorge'], ['Merlin', 'expert'], ['Morgana', 'easy']]),
  res([['Matthias'], ['Merlin', 'expert'], ['Jorge']]),
]);
check(podium['id-Jorge']?.games === 1 && podium['id-Jorge']?.firsts === 0, 'rating: the practice win is not counted');
check(podium['id-Matthias']?.firsts === 1, 'rating: the 2-people game is counted');
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
