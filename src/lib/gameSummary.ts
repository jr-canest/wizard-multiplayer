import type { RoomDoc } from './types';
import type { AISummaryPayload } from './firebase';

// Names are wrapped in <b> tags for bold rendering.
function b(name: string): string {
  return `<b>${name}</b>`;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return b(names[0]);
  if (names.length === 2) return `${b(names[0])} and ${b(names[1])}`;
  return (
    names.slice(0, -1).map(b).join(', ') +
    ', and ' +
    b(names[names.length - 1])
  );
}

const SENTENCES: Record<string, string[]> = {
  dominance: [
    "{1st} waved the wand like the deck was under a spell. {2nd} and {3rd} never stood a chance. {rest}",
    "The Grand Wizard has spoken. {1st} saw the future every single round. {2nd} and {3rd} were playing a different game entirely. {rest}",
    "{1st} played like the deck was enchanted from the start. {2nd} and {3rd}, better luck next prophecy. {rest}",
    "Was that magic or just skill? {1st} left the table spellbound. {2nd} and {3rd} are still figuring out what happened. {rest}",
  ],
  close: [
    "{1st} edges out {2nd} by a whisker on the wizard's beard. {3rd} watches from the crystal ball. That was anyone's game until the last card. {rest}",
    "{1st} and {2nd} duelled wands to the final round. {1st} blinked last. {3rd} stirred the potion bravely. {rest}",
    "A single trick separated {1st} from {2nd}. {3rd} was right there brewing too. The council demands a rematch. {rest}",
    "The crystal ball couldn't have predicted this finish. {1st} barely outcast {2nd}. {3rd} was a spell away from glory. {rest}",
  ],
  comeback: [
    "{1st} rose like a phoenix spell. Down and out, then untouchable. {2nd} and {3rd} watched the magic unfold. {rest}",
    "Never count a wizard out. {1st} wandered the enchanted forest and still found the crown. {2nd} and {3rd} learned that the hard way. {rest}",
    "From bottom of the tower to the top — {1st} pulled off the greatest spell reversal in wizard history. {2nd} and {3rd} are still wide-eyed. {rest}",
    "Somebody check {1st}'s sleeves — that comeback was suspiciously magical. {2nd} and {3rd} demand a wand inspection. {rest}",
  ],
  steady: [
    "{1st} played it cool as a frozen wand, bid it clean, and walked away with the win. {2nd} and {3rd} kept the potions steady. {rest}",
    "No chaos, no wild spells — just quiet mastery from {1st}. {2nd} and {3rd} ran an honest enchantment. {rest}",
    "{1st} read the cards like a seasoned oracle. No drama, just precision. {2nd} and {3rd} kept composure at the table. {rest}",
    "Boring? No. Clinical. {1st} bid with wizard-level precision all game long. {2nd} and {3rd} brewed a clean cauldron too. {rest}",
  ],
  chaotic: [
    "What in Merlin's name just happened? {1st} somehow emerged from the magical mishap. {2nd} and {3rd} made it out in one piece. {rest}",
    "The lead changed hands more times than a wand in a duel. {1st} held on by a spell. {2nd} and {3rd} have stories to tell. {rest}",
    "Absolute fireworks of a game. {1st} bubbled up with the crown. {2nd} and {3rd} are still sorting the sparks. {rest}",
  ],
  meltdown: [
    "Bids went sideways all night. {1st} won, but nobody's popping confetti. {2nd} and {3rd} are nursing bruised pride. {rest}",
    "The spells misfired left and right tonight. {1st} kept the wand steady. {2nd} and {3rd} weren't so lucky. {rest}",
    "Negative points everywhere — this wasn't a card game, it was a potion gone very wrong. {1st} dodged the splash. {2nd} and {3rd} need a hot cocoa. {rest}",
    "Someone forgot to put the lid on the cauldron. {1st} ducked in time. {2nd} and {3rd} took a face full of fizzy potion. {rest}",
  ],
  fallback: [
    "{1st} claims the title of Grand Wizard. {2nd} earns the rank of Apprentice. {rest}",
    "The enchanted cards have spoken. {1st} stands victorious, {2nd} bows gracefully. {rest}",
    "A duel of wits between {1st} and {2nd}. Only one could wear the pointy hat. {rest}",
    "{1st} wins! {2nd} can keep the broomstick as a consolation prize. {rest}",
  ],
  tied_first: [
    "A shared prophecy! {1st} — the Wizard Crown must be split! {2nd} and {3rd} bow to the co-rulers. {rest}",
    "One throne, multiple wizards. {1st} share the crown in an unprecedented tie. {2nd} and {3rd} witnessed history. {rest}",
    "The sorting spell came up even — {1st} finished dead level! {2nd} and {3rd} watched the council scramble for extra crowns. {rest}",
    "Not even the oracle could separate {1st}. A tie at the top! {2nd} and {3rd} saw something truly rare. {rest}",
  ],
};

const REST_PHRASES = [
  '{rest} — may the next prophecy be kinder.',
  '{rest} — the cauldron awaits your return.',
  '{rest} — every wizard has an off night.',
  '{rest} — the enchanted forest has room for everyone.',
  '{rest} — better luck in the next realm.',
  "{rest} — the cards weren't feeling generous.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type Standing = { name: string; score: number; rank: number };

function groupedRanks(standings: Standing[]) {
  const groups: { rank: number; players: Standing[]; score: number }[] = [];
  let currentScore: number | null = null;
  for (const s of standings) {
    if (s.score !== currentScore) {
      groups.push({
        rank: groups.reduce((sum, g) => sum + g.players.length, 0),
        players: [s],
        score: s.score,
      });
      currentScore = s.score;
    } else {
      groups[groups.length - 1].players.push(s);
    }
  }
  return groups;
}

/**
 * Reconstruct per-round running totals from the room's log entries. Mirrors
 * the scorekeeper's getRunningTotals so AI inputs match.
 */
function runningTotalsFromLog(room: RoomDoc): Array<{
  round: number;
  totals: Record<string, number>;
}> {
  const out: Array<{ round: number; totals: Record<string, number> }> = [];
  const running: Record<string, number> = {};
  for (const name of room.playerOrder) running[name] = 0;
  for (const entry of room.log) {
    if (entry.t === 'roundScore') {
      for (const [name, delta] of Object.entries(entry.scores)) {
        running[name] = (running[name] ?? 0) + delta;
      }
      out.push({ round: entry.round, totals: { ...running } });
    }
  }
  return out;
}

function rankAt(
  totals: Record<string, number>,
  players: string[],
  target: string,
): number {
  const scores = players.map((n) => totals[n] ?? 0).sort((a, b) => b - a);
  const targetScore = totals[target] ?? 0;
  return scores.indexOf(targetScore);
}

function leaderAt(
  totals: Record<string, number>,
  players: string[],
): string | null {
  let max = -Infinity;
  let leader: string | null = null;
  for (const n of players) {
    const s = totals[n] ?? 0;
    if (s > max) {
      max = s;
      leader = n;
    }
  }
  return leader;
}

export function buildAISummaryPayload(room: RoomDoc): AISummaryPayload {
  const standings: Standing[] = room.playerOrder
    .map((name) => ({
      name,
      score: room.cumulativeScores[name] ?? 0,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const totals = runningTotalsFromLog(room);

  let leadChanges = 0;
  let prevLeader: string | null = null;
  for (const t of totals) {
    const ldr = leaderAt(t.totals, room.playerOrder);
    if (prevLeader !== null && ldr !== prevLeader) leadChanges++;
    prevLeader = ldr;
  }

  let biggestLead = 0;
  for (const t of totals) {
    const ranked = room.playerOrder
      .map((n) => t.totals[n] ?? 0)
      .sort((a, b) => b - a);
    const gap = (ranked[0] ?? 0) - (ranked[1] ?? 0);
    if (gap > biggestLead) biggestLead = gap;
  }

  let comebackRank: number | null = null;
  if (standings.length > 0) {
    const winner = standings[0].name;
    let worst = 0;
    for (const t of totals) {
      const r = rankAt(t.totals, room.playerOrder, winner);
      if (r > worst) worst = r;
    }
    if (worst > 0) comebackRank = worst + 1;
  }

  const negativeCount = standings.filter((s) => s.score < 0).length;

  return {
    players: standings.map((s) => ({
      name: s.name,
      score: s.score,
      rank: s.rank,
      shamePoints: 0,
    })),
    roundCount: room.totalRounds,
    canadianRules: !!room.canadianRule,
    leadChanges,
    biggestLead,
    comebackRank,
    negativeCount,
  };
}

/**
 * Deterministic recap used while the AI call is in flight or when it fails.
 * Picks a category from the same set the scorekeeper uses.
 */
export function getFallbackSummary(room: RoomDoc): string {
  const standings: Standing[] = room.playerOrder
    .map((name) => ({
      name,
      score: room.cumulativeScores[name] ?? 0,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  if (standings.length < 2) return '';

  const groups = groupedRanks(standings);
  const firstGroup = groups[0];
  const secondGroup = groups[1];
  const thirdGroup = groups.length >= 3 ? groups[2] : null;

  const firstNames = firstGroup.players.map((p) => p.name);
  const secondNames = secondGroup ? secondGroup.players.map((p) => p.name) : [];
  const thirdNames = thirdGroup ? thirdGroup.players.map((p) => p.name) : [];
  const topCount =
    firstGroup.players.length +
    (secondGroup?.players.length ?? 0) +
    (thirdGroup?.players.length ?? 0);
  const restNames = standings.slice(topCount).map((s) => s.name);

  const margin = firstGroup.score - (secondGroup?.score ?? 0);
  const totals = runningTotalsFromLog(room);
  const tiedFirst = firstGroup.players.length > 1;

  let category = 'fallback';
  if (tiedFirst) {
    category = 'tied_first';
  } else if (standings.length < 3 || !thirdGroup) {
    category = 'fallback';
  } else {
    const midpoint = Math.floor(totals.length / 2);
    if (midpoint >= 1) {
      const mid = totals[midpoint - 1].totals;
      const winnerRankAtMid = rankAt(mid, room.playerOrder, firstGroup.players[0].name);
      if (winnerRankAtMid >= 2) category = 'comeback';
    }
    if (category === 'fallback' && firstGroup.score > 0 && margin >= firstGroup.score * 0.3) {
      category = 'dominance';
    }
    if (category === 'fallback' && totals.length >= 3) {
      let leadChanges = 0;
      let prevLeader: string | null = null;
      for (const t of totals) {
        const ldr = leaderAt(t.totals, room.playerOrder);
        if (prevLeader !== null && ldr !== prevLeader) leadChanges++;
        prevLeader = ldr;
      }
      if (leadChanges >= 4) category = 'chaotic';
    }
    if (category === 'fallback' && margin <= 20) category = 'close';
    if (
      category === 'fallback' &&
      standings.filter((s) => s.score < 0).length >= 2
    ) {
      category = 'meltdown';
    }
    if (category === 'fallback') category = 'steady';
  }

  let sentence = pickRandom(SENTENCES[category]);
  let restPhrase = '';
  if (restNames.length > 0) {
    restPhrase = pickRandom(REST_PHRASES).replace('{rest}', joinNames(restNames));
  }
  sentence = sentence.replaceAll('{1st}', joinNames(firstNames));
  sentence = sentence.replaceAll('{2nd}', joinNames(secondNames));
  sentence = sentence.replaceAll('{3rd}', joinNames(thirdNames));
  sentence = sentence.replaceAll('{rest}', restPhrase);
  sentence = sentence.replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim();
  return sentence;
}
