// One-off: recompute bestScore + worstScore for one or more players by
// scanning every stored game (up to the most recent 500) for the
// player's canonical name plus any aliases. Existing GP / wins /
// totalScore are NOT touched — those are tracked by increment() and
// stay in sync as games are added/deleted. Use this to repair best /
// worst drift after deleting a game in a version of the app that
// didn't recompute them (anything before commit b39cc46).
//
// Usage:
//   node scripts/recompute-player-stats_V01.mjs                    # dry-run, all players
//   node scripts/recompute-player-stats_V01.mjs --apply            # apply to all
//   node scripts/recompute-player-stats_V01.mjs "Matthias"         # dry-run, one player (case-insensitive name match)
//   node scripts/recompute-player-stats_V01.mjs "Matthias" --apply # apply to one

import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const targetName = args.find((a) => !a.startsWith('--'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('Loading players + games…');
const [playersSnap, gamesSnap] = await Promise.all([
  getDocs(collection(db, 'players')),
  getDocs(query(collection(db, 'games'), orderBy('date', 'desc'), limit(500))),
]);

const allPlayers = playersSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
const games = gamesSnap.docs.map((d) => d.data());

console.log(`  ${allPlayers.length} players, ${games.length} games`);

// Pick the target set.
const targets = targetName
  ? allPlayers.filter(
      (p) =>
        (p.name ?? '').trim().toLowerCase() === targetName.trim().toLowerCase(),
    )
  : allPlayers.filter((p) => !p.mergedInto);

if (targets.length === 0) {
  console.log(`\nNo matching players for "${targetName ?? '(all)'}".`);
  process.exit(1);
}

console.log(
  `\nRecomputing for ${targets.length} player${targets.length === 1 ? '' : 's'}:\n`,
);

let changed = 0;
for (const p of targets) {
  const namesForRecompute = [p.name, ...(p.aliases ?? [])].filter(
    (n) => typeof n === 'string' && n.length > 0,
  );
  const nameSet = new Set(namesForRecompute);
  let best = null;
  let worst = null;
  let gameCount = 0;
  for (const g of games) {
    for (const r of g.results ?? []) {
      if (nameSet.has(r.name)) {
        gameCount += 1;
        if (best === null || r.score > best) best = r.score;
        if (worst === null || r.score < worst) worst = r.score;
      }
    }
  }

  const prevBest = p.bestScore ?? null;
  const prevWorst = p.worstScore ?? null;
  const bestChanged = prevBest !== best;
  const worstChanged = prevWorst !== worst;

  const namesStr = namesForRecompute.length > 1
    ? ` (${namesForRecompute.join(', ')})`
    : '';
  console.log(
    `  ${p.name}${namesStr}: best ${prevBest ?? '—'} → ${best ?? '—'}   worst ${prevWorst ?? '—'} → ${worst ?? '—'}   (${gameCount} game record${gameCount === 1 ? '' : 's'})`,
  );

  if (!bestChanged && !worstChanged) continue;
  changed += 1;

  if (apply) {
    await updateDoc(p.ref, { bestScore: best, worstScore: worst });
    console.log(`    ✓ applied`);
  }
}

console.log(
  `\n${changed} player${changed === 1 ? '' : 's'} would change.${apply ? ' Applied.' : ' Dry run — re-run with --apply to commit.'}`,
);
process.exit(0);
