// One-off (2026-11-23): remove the 10 extra copies of one scorekeeper game
// (Bad guy timmy 140 / Elizabeth 110 / 🍕 100, re-saved on every reopen,
// Nov 20-22) and roll their share back out of the player stats, the way
// the apps' own deleteHistoryGame does. Keeps the first save.
//   node scripts/delete-duplicate-games_V01.mjs            # dry run
//   node scripts/delete-duplicate-games_V01.mjs --apply
import { initializeApp } from 'firebase/app';
import { deleteDoc, doc, getDoc, getFirestore, increment, updateDoc } from 'firebase/firestore';
const app = initializeApp({ apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88', authDomain: 'wizard-scores-2521c.firebaseapp.com', projectId: 'wizard-scores-2521c', appId: '1:37372424805:web:383851762365e1b6f3cc8c' });
const db = getFirestore(app);
const apply = process.argv.includes('--apply');
const KEEP = 'BJ0tKQ9WpMCF9waaZxJX';
const EXTRA = ['MAJlWY1EnCfniXUmpKmK','0205jQkYMRuQX5WoBZ5G','XNTe6zgNvRpB6txQ6ptn','vDBqCrHXCNTh1y34en4R','ZskLUrBIMRh6BOLKTkWw','MpuqozSFn0H7qCut1tKn','cFVfmH8NN66x3a6XsgMv','1gJlFiZ5d2VisCQJcwTC','LyRgEu7SWjXbklCCYIDu','xP1nf0D7wVe8cu0e7quA'];
const sig = (d) => JSON.stringify([d.roundCount, (d.results || []).map((r) => [r.name, r.score, r.shamePoints || 0])]);
async function canonical(id) { for (let i = 0; i < 5; i++) { const s = await getDoc(doc(db, 'players', id)); const m = s.data()?.mergedInto; if (!m) return id; id = m; } return id; }
async function stats(label, ids) { for (const id of ids) { const p = (await getDoc(doc(db, 'players', id))).data(); console.log(label, p?.name, 'GP', p?.gamesPlayed, 'wins', p?.wins, 'total', p?.totalScore, 'shame', p?.totalShamePoints, 'best', p?.bestScore, 'worst', p?.worstScore); } }
const keep = (await getDoc(doc(db, 'games', KEEP))).data();
if (!keep) throw new Error('keeper missing');
const want = sig(keep);
const ids = await Promise.all(keep.results.map((r) => canonical(r.playerId)));
await stats('before', ids);
const top = Math.max(...keep.results.map((r) => r.score));
let n = 0;
for (const id of EXTRA) {
  const snap = await getDoc(doc(db, 'games', id));
  if (!snap.exists()) { console.log('gone already', id); continue; }
  const d = snap.data();
  if (sig(d) !== want || d.source !== 'scorekeeper') { console.log('NOT identical, skipped', id); continue; }
  console.log(apply ? 'delete' : 'would delete', id, d.date.toDate().toISOString());
  if (!apply) continue;
  await deleteDoc(doc(db, 'games', id));
  for (let i = 0; i < d.results.length; i++) {
    const r = d.results[i];
    const u = { gamesPlayed: increment(-1), totalScore: increment(-r.score), totalShamePoints: increment(-(r.shamePoints || 0)) };
    if (r.score === top) u.wins = increment(-1);
    await updateDoc(doc(db, 'players', ids[i]), u);
  }
  n++;
}
console.log(apply ? `deleted ${n}` : 'dry run');
if (apply) await stats('after ', ids);
process.exit(0);
