// One-off: delete test-artifact player docs (name starts with "test",
// zero games played, not merged) from the shared `players` collection.
// Usage:
//   node scripts/delete-test-players_V01.mjs            # dry run
//   node scripts/delete-test-players_V01.mjs --apply    # actually deletes
//
// Project rules currently allow open writes, so this uses the public web
// SDK with the same firebaseConfig as the app. Safety: refuses to touch
// any doc with gamesPlayed > 0 or a mergedInto pointer.

import { initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};

const apply = process.argv.includes('--apply');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const snap = await getDocs(collection(db, 'players'));
const targets = snap.docs.filter((d) => {
  const p = d.data();
  const nameLower = (p.nameLower || p.name || '').toLowerCase();
  return (
    nameLower.startsWith('test') &&
    (p.gamesPlayed || 0) === 0 &&
    !p.mergedInto
  );
});

if (targets.length === 0) {
  console.log('No test player docs found.');
  process.exit(0);
}

for (const d of targets) {
  const p = d.data();
  console.log(`${apply ? 'DELETING' : 'would delete'}: ${p.name} (${d.id})`);
  if (apply) await deleteDoc(doc(db, 'players', d.id));
}
console.log(apply ? 'Done.' : 'Dry run — re-run with --apply to delete.');
process.exit(0);
