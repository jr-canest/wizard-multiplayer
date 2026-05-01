// One-off: delete the N most recent docs in the shared `games` collection.
// Usage:
//   node scripts/delete-recent-games_V01.mjs            # dry run, prints top 2
//   node scripts/delete-recent-games_V01.mjs --apply    # actually deletes them
//
// Project rules currently allow open writes, so this uses the public web
// SDK with the same firebaseConfig as the app.

import { initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};

const N = 2;
const apply = process.argv.includes('--apply');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const q = query(collection(db, 'games'), orderBy('date', 'desc'), limit(N));
const snap = await getDocs(q);

if (snap.empty) {
  console.log('No games found.');
  process.exit(0);
}

console.log(`Top ${snap.docs.length} most recent games:`);
for (const d of snap.docs) {
  const data = d.data();
  const date = data.date?.toDate?.()?.toISOString?.() ?? 'unknown';
  const players = (data.results ?? [])
    .map((r) => `${r.name}(${r.score})`)
    .join(', ');
  console.log(`  ${d.id}  ${date}  [${players}]`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}

console.log('\nDeleting…');
for (const d of snap.docs) {
  await deleteDoc(d.ref);
  console.log(`  ✓ deleted ${d.id}`);
}
console.log('Done.');
process.exit(0);
