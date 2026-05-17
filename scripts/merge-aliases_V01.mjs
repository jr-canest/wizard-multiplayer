// One-off: merge alias player docs into a canonical player doc.
// Sums gamesPlayed/wins/totalScore, max of bestScore, min of worstScore,
// adds the alias's name to canonical.aliases[], and marks the alias doc
// with mergedInto: <canonicalId> + zeros its aggregate stats so the
// history view doesn't double-count.
//
// Past `games` collection docs are NOT rewritten — they keep the player
// name as recorded at the time. The History view aggregates by player
// doc, so collapsing the alias doc is sufficient.
//
// Usage:
//   node scripts/merge-aliases_V01.mjs                # dry run, prints plan
//   node scripts/merge-aliases_V01.mjs --apply        # actually merge
//
// To edit the pairs, change MERGES below. Each pair is [canonical, alias]
// using the names as they appear in the players collection (case-insensitive
// match via nameLower).

import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};

// [canonical, alias] — alias's stats get folded into canonical.
const MERGES = [
  ['Manuel', 'Manuel / Neto'],
  ['Esteban', 'Stefan'],
];

const apply = process.argv.includes('--apply');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findPlayer(name) {
  const nameLower = name.trim().toLowerCase();
  const q = query(
    collection(db, 'players'),
    where('nameLower', '==', nameLower),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ref: snap.docs[0].ref, data: snap.docs[0].data() };
}

function fmtStats(d) {
  return `gp=${d.gamesPlayed ?? 0} w=${d.wins ?? 0} total=${d.totalScore ?? 0} best=${d.bestScore ?? '—'} worst=${d.worstScore ?? '—'}`;
}

let exitCode = 0;
for (const [canonicalName, aliasName] of MERGES) {
  console.log(`\n→ ${canonicalName}  ⇐  ${aliasName}`);
  const canon = await findPlayer(canonicalName);
  const alias = await findPlayer(aliasName);
  if (!canon) {
    console.log(`  ✗ canonical "${canonicalName}" not found, skipping`);
    exitCode = 1;
    continue;
  }
  if (!alias) {
    console.log(`  ✗ alias "${aliasName}" not found, skipping`);
    exitCode = 1;
    continue;
  }
  if (canon.id === alias.id) {
    console.log(`  ✗ canonical and alias are the same doc, skipping`);
    continue;
  }
  if (alias.data.mergedInto) {
    console.log(`  ✓ already merged into ${alias.data.mergedInto}, skipping`);
    continue;
  }

  console.log(`  canon  ${canon.id}  ${fmtStats(canon.data)}`);
  console.log(`  alias  ${alias.id}  ${fmtStats(alias.data)}`);

  const a = alias.data;
  const c = canon.data;
  const sumGp = (c.gamesPlayed ?? 0) + (a.gamesPlayed ?? 0);
  const sumWins = (c.wins ?? 0) + (a.wins ?? 0);
  const sumScore = (c.totalScore ?? 0) + (a.totalScore ?? 0);
  const sumShame = (c.totalShamePoints ?? 0) + (a.totalShamePoints ?? 0);
  const mergedBest =
    a.bestScore === undefined || a.bestScore === null
      ? c.bestScore ?? null
      : c.bestScore === undefined || c.bestScore === null
        ? a.bestScore
        : Math.max(c.bestScore, a.bestScore);
  const mergedWorst =
    a.worstScore === undefined || a.worstScore === null
      ? c.worstScore ?? null
      : c.worstScore === undefined || c.worstScore === null
        ? a.worstScore
        : Math.min(c.worstScore, a.worstScore);
  const aliasNames = Array.from(
    new Set([...(c.aliases ?? []), a.name ?? aliasName]),
  );

  console.log(
    `  result canon  gp=${sumGp} w=${sumWins} total=${sumScore} best=${mergedBest ?? '—'} worst=${mergedWorst ?? '—'} aliases=${JSON.stringify(aliasNames)}`,
  );

  if (!apply) continue;

  await updateDoc(canon.ref, {
    gamesPlayed: sumGp,
    wins: sumWins,
    totalScore: sumScore,
    totalShamePoints: sumShame,
    bestScore: mergedBest,
    worstScore: mergedWorst,
    aliases: aliasNames,
  });
  await updateDoc(alias.ref, {
    mergedInto: canon.id,
    gamesPlayed: 0,
    wins: 0,
    totalScore: 0,
    totalShamePoints: 0,
    bestScore: null,
    worstScore: null,
  });
  console.log(`  ✓ merged`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to merge.');
}
process.exit(exitCode);
