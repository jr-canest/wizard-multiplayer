// Inspect recent multiplayer rooms (read-only). Rooms need auth → anonymous sign-in.
//   node scripts/inspect-rooms_V01.mjs [--n=10] [--bots]
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, getDocs, getFirestore, limit, orderBy, query } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};
const n = parseInt((process.argv.find((a) => a.startsWith('--n=')) ?? '--n=10').slice(4), 10);
const onlyBots = process.argv.includes('--bots');

const app = initializeApp(firebaseConfig);
await signInAnonymously(getAuth(app));
const db = getFirestore(app);
const snap = await getDocs(query(collection(db, 'rooms'), orderBy('createdAt', 'desc'), limit(n)));
for (const d of snap.docs) {
  const r = d.data();
  if (onlyBots && !r.bots) continue;
  const created = r.createdAt?.toDate?.()?.toLocaleString('en-CA', { timeZone: 'America/Vancouver' }) ?? '?';
  const bytes = JSON.stringify(r).length;
  console.log(`\n=== ${d.id} · ${r.status} · created ${created} · ${(bytes / 1024).toFixed(1)} KB · rounds ${r.currentRound}/${r.totalRounds} · host ${r.hostPlayerName}`);
  console.log('players:', r.playerOrder.join(', '), '| bots:', JSON.stringify(r.bots ?? {}), '| canadian:', r.canadianRule);
  const log = r.log ?? [];
  const rounds = {};
  for (const e of log) {
    if (e.t === 'bid') (rounds[e.round] ??= { bids: {}, won: {}, scores: {} }).bids[e.player] = e.bid;
    if (e.t === 'trickWin') { const rr = (rounds[e.round] ??= { bids: {}, won: {}, scores: {} }); rr.won[e.winner] = (rr.won[e.winner] ?? 0) + 1; }
    if (e.t === 'roundScore') (rounds[e.round] ??= { bids: {}, won: {}, scores: {} }).scores = e.scores;
  }
  const names = r.playerOrder;
  console.log('round  ' + names.map((x) => x.padStart(14)).join(''));
  for (const [round, rr] of Object.entries(rounds)) {
    console.log(String(round).padStart(5) + '  ' + names.map((x) => `${rr.bids[x] ?? '-'}/${rr.won[x] ?? 0} ${String(rr.scores[x] ?? '').padStart(4)}`.padStart(14)).join(''));
  }
  const final = log.find((e) => e.t === 'gameOver')?.finalScores ?? r.cumulativeScores;
  console.log('final: ', names.map((x) => `${x} ${final?.[x] ?? '?'}`).join(' · '));
  console.log(`log entries ${log.length} · trickHistory ${r.trickHistory?.length ?? 0} · chat ${r.chat?.length ?? 0}`);
}
process.exit(0);
