// Which reaction phrases the table actually uses, most to least.
// Read-only; rooms/reactionStats need auth, so anonymous sign-in.
//   node scripts/reaction-stats_V01.mjs
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};

// Keep in sync with REACTIONS in src/lib/reactions.ts so phrases nobody
// has ever tapped still print, with a zero.
const CATALOGUE = [
  'ouch',
  'sorry!',
  'thanks!',
  'take your time',
  'skip skip skip',
  'no mercy',
  'respect the game',
  'bruno?',
  'why???',
];
const keyOf = (t) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

const app = initializeApp(firebaseConfig);
await signInAnonymously(getAuth(app));
const db = getFirestore(app);
const snap = await getDocs(collection(db, 'reactionStats'));

const counts = new Map();
for (const d of snap.docs) {
  const v = d.data();
  counts.set(d.id, {
    text: v.text ?? d.id,
    count: typeof v.count === 'number' ? v.count : 0,
    lastUsedAt: typeof v.lastUsedAt === 'number' ? v.lastUsedAt : null,
  });
}

const rows = [];
for (const text of CATALOGUE) {
  const key = keyOf(text);
  const hit = counts.get(key);
  counts.delete(key);
  rows.push({ text, count: hit?.count ?? 0, lastUsedAt: hit?.lastUsedAt ?? null, retired: false });
}
for (const [, v] of counts) {
  rows.push({ ...v, retired: true });
}
rows.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

const total = rows.reduce((a, r) => a + r.count, 0);
const width = Math.max(...rows.map((r) => r.text.length)) + 2;
const top = Math.max(1, ...rows.map((r) => r.count));
console.log(`\nReaction use (${total} sent all-time)\n`);
for (const r of rows) {
  const bar = '█'.repeat(Math.round((r.count / top) * 24));
  const last = r.lastUsedAt
    ? new Date(r.lastUsedAt).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
    : '';
  const tag = r.retired ? ' (retired)' : '';
  console.log(
    `${(r.text + tag).padEnd(width)} ${String(r.count).padStart(4)}  ${bar.padEnd(24)} ${last}`,
  );
}
console.log('');
process.exit(0);
