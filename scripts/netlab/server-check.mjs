// Drives the deployed game server through a whole short game over raw
// WebSockets, exercising what the browser rig does not: lobby bots, the
// rounds cap, undo, a round-end pop-up vote, chat, reactions, the finished
// snapshot's full log, the exactly-once history claim, and play again.
//   node scripts/netlab/server-check.mjs [https://wizard-game.jrcanest.workers.dev]
const S = process.argv[2] ?? 'https://wizard-game.jrcanest.workers.dev';
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

const toks = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await token(n)])));
const created = await fetch(`${S}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${toks.netA}` }, body: JSON.stringify({ canadianRule: true }) }).then((r) => r.json());
const code = created.code;
console.log('room', code);
const A = new Client('netA', toks.netA, code); await A.connect();
const B = new Client('netB', toks.netB, code); await B.connect();
check(await until(() => A.room.playerOrder.includes('netB')), 'host sees netB join');
// Lobby: bots and the rounds cap, host-only.
await B.act('addBot', 'easy').then(() => check(false, 'non-host addBot refused'), (e) => check(e.message === 'notHost', 'non-host addBot refused'));
const botName = await A.act('addBot', 'medium');
check(typeof botName === 'string' && (await until(() => B.room.playerOrder.includes(botName))), `bot ${botName} seated for everyone`);
await A.act('setChosenTotalRounds', 3);
check(await until(() => B.room.chosenTotalRounds === 3), 'rounds cap propagated');
await A.act('sendChat', 'hello from A');
check(await until(() => B.chat.some((m) => m.text === 'hello from A' && m.w === '0:lobby')), 'chat delivered with lobby window key');
await A.act('startGame');
check(await until(() => A.room.status === 'bidding' || A.room.status === 'dealing'), 'game started');
check(A.hand && A.hand.length === 1 && B.hand && B.hand.length === 1, 'each human holds 1 card in round 1');
check(A.state.players.find((p) => p.name === botName)?.isBot === true, 'bot flagged in presence');

// Play three rounds; bots act on the server; humans answer their turns.
let undoTested = false, voteTested = false;
for (let guard = 0; guard < 400 && A.room.status !== 'finished'; guard++) {
  const r = A.room;
  const turn = r.playerOrder[r.currentPlayerIndex];
  const me = turn === 'netA' ? A : turn === 'netB' ? B : null;
  if (r.status === 'dealing' && r.awaitingTrumpChoice) {
    const dealer = r.playerOrder[r.dealerIndex];
    if (dealer === 'netA') await A.act('chooseTrumpSuit', 'H'); else if (dealer === 'netB') await B.act('chooseTrumpSuit', 'H');
    await sleep(100); continue;
  }
  if (r.status === 'bidding' && me) {
    // Dealer under the Canadian rule may be barred from one value.
    for (const bid of [0, 1, 2, 3]) { try { await me.act('placeBid', bid); break; } catch (e) { if (e.message !== 'canadianRuleViolation') throw e; } }
    await sleep(80); continue;
  }
  if (r.status === 'playing' && me) {
    const idx = legal(me.hand, r.trickInProgress);
    await me.act('playCard', idx);
    if (!undoTested && r.currentRound === 2) {
      // Undo right after my play: opens a table vote; B rejects it.
      undoTested = true;
      await sleep(150);
      if (me.room.pendingUndo?.actor === me.name && !me.room.pendingUndo.requested) {
        await me.act('requestUndo');
        check(await until(() => B.room.pendingUndo?.requested === true), 'undo vote opened for everyone');
        const other = me === A ? B : A;
        await other.act('voteUndo', false);
        check(await until(() => A.room.pendingUndo === null || A.room.pendingUndo === undefined), 'undo denied by the other player');
      } else check(true, 'undo skipped (turn passed)');
    }
    await sleep(80); continue;
  }
  if (r.status === 'scoring') {
    if (!voteTested && r.currentRound === 1) {
      voteTested = true;
      await A.act('openRoundVote', 'lastRound');
      check(await until(() => B.room.pendingVote?.kind === 'lastRound'), 'last-round vote opened');
      await B.act('castRoundVote', false);
      check(await until(() => A.room.pendingVote == null), 'last-round vote dismissed by no');
      check(A.room.totalRounds === 3, 'total rounds unchanged after the no');
    }
    if (!(r.nextRoundVotes ?? []).includes('netA')) await A.act('voteNextRound', true);
    if (!(B.room.nextRoundVotes ?? []).includes('netB')) await B.act('voteNextRound', true);
    await until(() => A.room.status !== 'scoring' || A.room.currentRound > r.currentRound, 5000);
    continue;
  }
  await sleep(120);
}
check(A.room.status === 'finished', 'game finished');
check(A.room.log.filter((e) => e.t === 'roundScore').length === 3, 'finished snapshot carries all 3 round scores');
check(A.room.log.filter((e) => e.t === 'play').length === 3 * (1 + 2 + 3), 'finished snapshot carries every play (full log)');
const c1 = await A.act('claimHistory'); const c2 = await B.act('claimHistory');
check(c1.go === true && c2.go === false, 'history claim handed out exactly once');
await A.act('markHistorySaved', 'test-game-id');
check(await until(() => B.room.historyGameId === 'test-game-id'), 'history id shared');
check((await A.act('claimAiSummary')) === true && (await B.act('claimAiSummary')) === false, 'recap claim exactly once');
await A.act('setSharedAiSummary', 'A fine game.');
check(await until(() => B.room.aiSummary === 'A fine game.'), 'recap shared');
await A.act('votePlayAgain', true); await B.act('votePlayAgain', true);
check(await until(() => A.room.status === 'lobby' && A.room.currentRound === 0 && A.room.log.length === 0), 'play again reset the room');
check(A.room.chatGen === 1, 'chat window generation bumped');
// Presence: closing B's socket shows as disconnected within a moment.
B.close();
check(await until(() => A.state.players.find((p) => p.name === 'netB')?.connected === false, 8000), 'closed socket reads as disconnected');
A.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
