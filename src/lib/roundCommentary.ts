// Round-end commentary (Jorge, 2026-11-26): one cheer and one roast for the
// players the round moved most, picked by rule from the scores, so it is
// instant and every phone shows the same lines (the pick is seeded by the
// game and round, never Math.random). SHARED VERBATIM with the scorekeeper
// (src/utils/roundCommentary.ts there): edit one, copy to the other.
// Copy rules: name the player, never a pronoun; no em dashes; family table.

export type CommentaryPlayer = {
  name: string;
  /** Points this round. */
  delta: number;
  /** Total after this round. */
  total: number;
  bid: number;
  won: number;
  /** Made bids in a row, counting this round (0 when this one missed). */
  madeStreak?: number;
  /** Missed bids in a row, counting this round (0 when this one was made). */
  missStreak?: number;
};

export type CommentaryLine = {
  emoji: string;
  /** The sentence in pieces, so the screen can set the names apart. */
  segs: Array<{ t: string; name?: boolean }>;
  tone: 'up' | 'down' | 'all';
  /** Whose row this line is about (first name in it), if any. */
  player?: string;
};

/** Competition ranks by total: ties share a rank (1, 2, 2, 4). */
export function rankByTotal(totals: Record<string, number>): Record<string, number> {
  const names = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const out: Record<string, number> = {};
  let lastScore = Number.NaN;
  let lastRank = 0;
  names.forEach((n, i) => {
    if (totals[n] !== lastScore) { lastRank = i + 1; lastScore = totals[n]; }
    out[n] = lastRank;
  });
  return out;
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
const num = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// {N} the player, {M} a second player, {K} spots moved, {P} the new place,
// {D} points this round, {S} a streak, {B} bid, {W} tricks won, {T} total.
const LINES = {
  tookLead: [
    '🚀|{N} blasts off into the lead',
    '👑|{N} takes the throne',
    '🔥|{N} storms into first place',
    '🧙|{N} is the new head wizard',
    '📈|{N} leaps to the top of the table',
    '🏎️|{N} overtakes everyone. First place!',
  ],
  earlyLead: [
    '🏁|{N} grabs the early lead',
    '🌅|{N} is out in front. It is early',
    '🐇|{N} is off to a flying start',
  ],
  climb: [
    '🪜|{N} climbs {K}, up to {P}',
    '⚡|{N} is on the move: {P} now',
    '🐎|{N} gallops up to {P}',
    '🎈|{N} floats up to {P}',
  ],
  bigHaul: [
    '💰|{N} cashes in +{D}',
    '🎯|{N} nails it for +{D}',
    '✨|{N} casts a perfect +{D}',
    '🍒|{N} picks up a juicy +{D}',
  ],
  hotStreak: [
    '🔥|{N} has made {S} bids in a row',
    '🧊|{N} cannot miss: {S} straight',
    '🔮|{N} sees the future: {S} bids made running',
  ],
  onlyOne: [
    '😎|{N} is the only one who made the bid',
    '🦸|{N} made the bid. Nobody else did',
  ],
  holdLead: [
    '🏰|{N} tightens the grip on first',
    '👑|{N} is still in charge',
    '🛡️|{N} defends the lead',
  ],
  zeroHero: [
    '🥷|{N} bid 0 and dodged every trick',
    '👻|{N} ghosts the whole round: 0 bid, 0 taken',
  ],
  lostLead: [
    '💥|{N} tumbles off the top',
    '📉|{N} gives the crown away',
    '🫠|{N} was first. Was',
    '🪦|Here lies the lead of {N}',
  ],
  drop: [
    '🕳️|{N} drops {K}, down to {P}',
    '🛝|{N} slides down to {P}',
    '🪂|{N} is falling: {P} now',
    '🧻|{N} unravels down to {P}',
  ],
  missStreak: [
    '🤦|{N} loses again',
    '🧱|{N} misses again: {S} in a row',
    '🎪|{N}, {S} misses in a row. Bold strategy',
    '🪄|The wand of {N} is out of batteries: {S} misses running',
    '🔁|{N} misses. Again. That is {S} straight',
  ],
  bigMiss: [
    '💸|{N} burns {D} points',
    '🫣|{N} bid {B} and took {W}',
    '🚨|{N} bid {B}, took {W}. Somebody call for help',
    '🧯|{N} sets {D} points on fire',
  ],
  zeroFail: [
    '🙈|{N} bid 0 and took {W}',
    '🧲|{N} bid 0 and the tricks came anyway: {W}',
  ],
  belowZero: [
    '🥶|{N} is below zero now: {T}',
    '🤿|{N} goes under: {T}',
    '🧊|{N} breaks through the ice: {T}',
  ],
  deeper: [
    '⛏️|{N} keeps digging: {T}',
    '🕳️|{N} is still going down: {T}',
    '🚇|{N} is exploring the basement: {T}',
  ],
  stillLast: [
    '🐢|{N} holds on to last place',
    '🪑|{N} is getting comfy in last',
    '🧹|{N} is sweeping the floor in last',
  ],
  miss: [
    '😬|{N} misses the bid',
    '🍌|{N} slips: {D}',
    '🥴|{N} bid {B}, took {W}. Close enough? No',
  ],
  allMade: [
    '🤝|Everyone made the bid. Suspicious',
    '🕊️|A clean round. Nobody to roast... yet',
    '📚|Textbook round: every bid made',
  ],
  allMissed: [
    '🤡|Nobody made the bid. Nobody',
    '🌪️|Chaos round: every single bid missed',
    '🚒|Every bid missed. Send help',
  ],
  tieTop: [
    '⚔️|{N} and {M} are tied for first',
    '🤼|{N} and {M} are locked together at the top',
  ],
} as const;

type Kind = keyof typeof LINES;
type Vars = { N?: string; M?: string; K?: string; P?: string; D?: string; S?: string; B?: string; W?: string; T?: string };

function build(kind: Kind, seed: string, tone: CommentaryLine['tone'], vars: Vars): CommentaryLine {
  const pool = LINES[kind];
  const [emoji, tpl] = pool[hash(`${seed}|${kind}`) % pool.length].split('|');
  const segs: CommentaryLine['segs'] = [];
  for (const piece of tpl.split(/(\{[A-Z]\})/)) {
    if (!piece) continue;
    const m = piece.match(/^\{([A-Z])\}$/);
    if (!m) { segs.push({ t: piece }); continue; }
    const key = m[1] as keyof Vars;
    segs.push({ t: vars[key] ?? '', name: key === 'N' || key === 'M' });
  }
  return { emoji, segs, tone, player: vars.N };
}

/**
 * Up to two lines for the round: a cheer, a roast, or a line about the
 * whole table. `seed` should be the game (room code or first round's id).
 */
export function roundCommentary(seed: string, round: number, players: CommentaryPlayer[]): CommentaryLine[] {
  if (players.length < 2) return [];
  const s = `${seed}|${round}`;
  const after: Record<string, number> = {};
  const before: Record<string, number> = {};
  for (const p of players) { after[p.name] = p.total; before[p.name] = p.total - p.delta; }
  const rAfter = rankByTotal(after);
  const rBefore = rankByTotal(before);
  const n = players.length;
  const firstRound = players.every((p) => p.total === p.delta);
  const made = players.filter((p) => p.bid === p.won);
  const missed = players.filter((p) => p.bid !== p.won);
  const leaders = players.filter((p) => rAfter[p.name] === 1);
  const lastRank = Math.max(...Object.values(rAfter));

  type Cand = { w: number; line: CommentaryLine };
  const ups: Cand[] = [];
  const downs: Cand[] = [];
  for (const p of players) {
    const ra = rAfter[p.name];
    const rb = rBefore[p.name];
    const v: Vars = {
      N: p.name, K: `${Math.abs(rb - ra)} ${Math.abs(rb - ra) === 1 ? 'spot' : 'spots'}`, P: ORD[ra] ?? `${ra}th`,
      D: `${Math.abs(p.delta)}`, S: `${Math.max(p.madeStreak ?? 0, p.missStreak ?? 0)}`, B: `${p.bid}`, W: `${p.won}`, T: num(p.total),
    };
    const up = (w: number, k: Kind) => ups.push({ w: w + p.delta / 1000, line: build(k, `${s}|${p.name}`, 'up', v) });
    const down = (w: number, k: Kind) => downs.push({ w: w - p.delta / 1000, line: build(k, `${s}|${p.name}`, 'down', v) });
    const sole = ra === 1 && leaders.length === 1;

    if (p.bid === p.won) {
      if (!firstRound && sole && rb > 1) up(100, 'tookLead');
      if (firstRound && sole) up(60, 'earlyLead');
      if (!firstRound && rb - ra >= 2) up(80 + (rb - ra), 'climb');
      if (made.length === 1 && n >= 3) up(75, 'onlyOne');
      if ((p.madeStreak ?? 0) >= 3) up(60 + (p.madeStreak ?? 0), 'hotStreak');
      if (p.delta >= 40) up(50 + p.delta / 10, 'bigHaul');
      if (p.bid === 0 && round >= 4) up(45, 'zeroHero');
      if (!firstRound && rb - ra === 1 && ra > 1) up(40, 'climb');
      if (!firstRound && sole && rb === 1) up(30, 'holdLead');
    } else {
      const off = Math.abs(p.bid - p.won);
      if (!firstRound && rb === 1 && ra > 1) down(100, 'lostLead');
      if ((p.missStreak ?? 0) >= 2) down(70 + (p.missStreak ?? 0) * 5, 'missStreak');
      if (!firstRound && ra - rb >= 2) down(80 + (ra - rb), 'drop');
      if (p.bid === 0 && p.won >= 2) down(78, 'zeroFail');
      if (off >= 2) down(60 + off * 5, 'bigMiss');
      if (p.total < 0 && p.total - p.delta >= 0) down(65, 'belowZero');
      if (!firstRound && ra - rb === 1) down(45, 'drop');
      if (p.total < 0 && p.total - p.delta < 0) down(35, 'deeper');
      if (!firstRound && ra === lastRank && rb === lastRank && n >= 3) down(30, 'stillLast');
      down(10, 'miss');
    }
  }
  ups.sort((a, b) => b.w - a.w);
  downs.sort((a, b) => b.w - a.w);

  const out: CommentaryLine[] = [];
  if (missed.length === 0) out.push(build('allMade', s, 'all', {}));
  if (made.length === 0) out.push(build('allMissed', s, 'all', {}));
  if (ups[0]) out.push(ups[0].line);
  if (out.length < 2 && leaders.length === 2 && !firstRound && !ups.some((u) => u.w >= 100)) {
    out.push(build('tieTop', s, 'all', { N: leaders[0].name, M: leaders[1].name }));
  }
  const roast = downs.find((d) => d.line.player !== out[0]?.player) ?? downs[0];
  if (roast && out.length < 2) out.push(roast.line);
  // A table line first, then the cheer; otherwise cheer before roast.
  return out.slice(0, 2);
}
