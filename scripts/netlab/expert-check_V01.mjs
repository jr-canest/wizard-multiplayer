// Plays one signed-in seat (netA) against TWO expert computers on the
// deployed game server and reports how long the computers take per turn.
// The expert thinks by simulation, so this is the check that its thinking
// still fits the server after a change to src/game/botAI.ts.
// Nothing is written to History (that write happens on a phone).
//   node scripts/netlab/expert-check_V01.mjs [rounds=12] [server url]
const ROUNDS = parseInt(process.argv[2] ?? '12', 10);
const S = process.argv[3] ?? 'https://wizard-game.jrcanest.workers.dev';
const WS = S.replace(/^http/, 'ws');
const NAMES = ['netA', 'netB', 'netC'];
const PIN = '4242';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failures++; };

async function token(name) {
  const r = await fetch(`${S}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, pin: PIN }) });
  return (await r.json()).token;
}
class Client {
  constructor(name, tok, code) { this.name = name; this.tok = tok; this.code = code; this.state = null; this.chat = []; this.pending = new Map(); this.n = 0; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS}/ws/${this.code}?token=${this.tok}`);
      this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'hello', join: true }));
      this.ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const m = JSON.parse(e.data);
        if (m.t === 'state') { this.state = m; if (m.chat) this.chat = m.chat; resolve(); }
        else if (m.t === 'chat') this.chat.push(m.msg);
        else if (m.t === 'ack') { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.code)); } }
        else if (m.t === 'error') reject(new Error(m.code));
      };
      this.ws.onerror = () => reject(new Error('ws error'));
    });
  }
  act(action, ...args) {
    return new Promise((resolve, reject) => {
      const id = String(this.n++);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ t: 'act', id, action, args }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('timeout')); }, 15000);
    });
  }
  get room() { return this.state.room; }
  get hand() { return this.state.hand; }
  close() { this.ws.close(); }
}
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; }
function legal(hand, plays) {
  const first = plays.find((p) => p.card.kind !== 'jester');
  if (!first || first.card.kind === 'wizard') return 0;
  const lead = first.card.suit;
  const i = hand.findIndex((c) => c.kind === 'standard' && c.suit === lead);
  return i >= 0 ? i : hand.findIndex(() => true);
}


const tok = await token('netA');
const created = await fetch(`${S}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ canadianRule: true }) }).then((r) => r.json());
console.log('room', created.code, '·', ROUNDS, 'rounds · netA vs two expert computers');
let A = new Client('netA', tok, created.code); await A.connect();
const bots = [await A.act('addBot', 'expert'), await A.act('addBot', 'expert')];
await A.act('setChosenTotalRounds', ROUNDS);
await A.act('startGame');
check(await until(() => A.room.status === 'bidding' || A.room.status === 'dealing'), 'game started');

// How long each computer turn takes, from the snapshot that puts it on the
// clock to the snapshot where it has moved. The server waits 250 ms before
// a computer acts and 2 s before it leads a new trick; the rest is thinking.
const waits = [];
let onClock = null;
// A laptop that naps mid-run freezes this script while the server plays on,
// which would read as a slow or stuck computer. A 200 ms heartbeat spots the
// nap (a gap of over 1.5 s) and any turn it overlapped is thrown away.
let lastBeat = Date.now(), napAt = 0, naps = 0;
setInterval(() => { const now = Date.now(); if (now - lastBeat > 1500) { napAt = now; naps++; } lastBeat = now; }, 200);
const napped = (since) => napAt >= since || Date.now() - lastBeat > 1500;
const settle = () => { if (onClock && !napped(onClock.t)) waits.push({ ...onClock, ms: Date.now() - onClock.t }); onClock = null; };
const key = (r) => `${r.status}:${r.currentRound}:${r.currentPlayerIndex}:${r.trickInProgress.length}:${Object.keys(r.bids ?? {}).length}`;
let stalled = false, connectedAt = Date.now(), reconnects = 0;
for (let guard = 0; guard < 20000 && A.room.status !== 'finished'; guard++) {
  // After a nap the socket is usually dead: open a fresh one (the server
  // answers with a full snapshot) and carry on.
  if (A.ws.readyState !== 1 || (napAt && napAt > connectedAt)) {
    onClock = null;
    try { A.ws.close(); } catch { /* already gone */ }
    A = new Client('netA', tok, created.code);
    try { await A.connect(); connectedAt = Date.now(); reconnects++; } catch { await sleep(1000); }
    continue;
  }
  const r = A.room;
  const turn = r.playerOrder[r.currentPlayerIndex];
  const live = r.status === 'bidding' || r.status === 'playing';
  if (live && bots.includes(turn)) {
    const k = key(r);
    if (!onClock || onClock.k !== k) { settle(); onClock = { k, t: Date.now(), round: r.currentRound, lead: r.status === 'playing' && r.trickInProgress.length === 0, bid: r.status === 'bidding' }; }
    else if (napped(onClock.t)) onClock.t = Date.now();
    else if (Date.now() - onClock.t > 20000) { stalled = true; console.log('STALL', k); break; }
    await sleep(15); continue;
  }
  settle();
  const stale = (e) => { if (['notYourTurn', 'notBidding', 'notPlaying', 'timeout'].includes(e.message)) return true; throw e; };
  if (r.status === 'dealing' && r.awaitingTrumpChoice) {
    if (r.playerOrder[r.dealerIndex] === 'netA') await A.act('chooseTrumpSuit', 'H').catch(stale);
    await sleep(60); continue;
  }
  if (r.status === 'bidding' && turn === 'netA') {
    const guess = Math.round(r.currentRound / 3);
    for (const bid of [guess, guess + 1, Math.max(0, guess - 1)]) { try { await A.act('placeBid', bid); break; } catch (e) { if (e.message !== 'canadianRuleViolation') { stale(e); break; } } }
    await sleep(40); continue;
  }
  if (r.status === 'playing' && turn === 'netA') {
    try { await A.act('playCard', legal(A.hand, r.trickInProgress)); } catch (e) { stale(e); }
    await sleep(40); continue;
  }
  if (r.status === 'scoring') {
    if (!(r.nextRoundVotes ?? []).includes('netA')) await A.act('voteNextRound', true).catch(() => {});
    await until(() => A.room.status !== 'scoring' || A.room.currentRound > r.currentRound, 5000);
    continue;
  }
  await sleep(30);
}
check(!stalled, 'no computer turn stalled');
check(A.room.status === 'finished', 'game finished');
const think = (w) => Math.max(0, w.ms - (w.lead ? 2000 : 250));
const by = (f) => waits.filter(f).map(think).sort((a, b) => a - b);
const stat = (a) => a.length ? `n ${a.length} · median ${a[a.length >> 1]} ms · p95 ${a[Math.floor(a.length * 0.95)]} ms · max ${a[a.length - 1]} ms` : 'none';
console.log('bids      ', stat(by((w) => w.bid)));
console.log('card plays', stat(by((w) => !w.bid)));
console.log('late rounds', stat(by((w) => w.round >= ROUNDS - 2)));
const worst = Math.max(0, ...waits.map(think));
check(worst < 3000, `slowest computer turn beyond its built-in pause: ${worst} ms (includes network)`);
if (naps) console.log(`(this computer napped ${naps} time(s) during the run; turns it overlapped are not counted; ${reconnects} reconnect(s))`);
console.log('final', JSON.stringify(A.room.cumulativeScores));
A.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
