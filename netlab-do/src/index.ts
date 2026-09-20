// Prototype: server-authoritative Wizard room on a Durable Object.
// Reuses the app's pure engine (deck, legal moves, trick winner, scoring).
// Wire format: the client keeps a local copy of the public state and the
// server sends small events; a (re)connect gets the full state once.
import { buildDeck, deal, shuffle, totalRoundsFor } from '../../src/game/deck';
import { isLegalPlay, getLeadInfo } from '../../src/game/legalMoves';
import { winningPlayIndex } from '../../src/game/trickWinner';
import { calcRoundScore } from '../../src/game/scoring';
import type { Card, Suit } from '../../src/lib/types';

type Play = { playerName: string; card: Card; playOrder: number };
type Trick = { trickNum: number; plays: Play[]; winner: string };
type Status = 'lobby' | 'dealing' | 'bidding' | 'playing' | 'scoring' | 'finished';
type Room = {
  code: string;
  status: Status;
  playerOrder: string[];
  dealerIndex: number;
  currentPlayerIndex: number;
  currentRound: number;
  currentTrick: number;
  totalRounds: number;
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  awaitingTrumpChoice: boolean;
  bids: Record<string, number>;
  tricksWon: Record<string, number>;
  cumulativeScores: Record<string, number>;
  trickInProgress: Play[];
  roundTricks: Trick[];
  nextRoundVotes: string[];
  seq: number;
};

const publicRoom = (r: Room) => r;

export class RoomDO {
  private room: Room | null = null;
  private hands: Record<string, Card[]> = {};
  private ready: Promise<void>;
  constructor(private ctx: DurableObjectState, private env: unknown) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>('room')) ?? null;
      this.hands = (await ctx.storage.get<Record<string, Card[]>>('hands')) ?? {};
    });
    // App-level keepalive answered by the runtime without waking the DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop() || 'ROOM';
    const name = url.searchParams.get('name') || 'anon';
    if (req.headers.get('Upgrade') !== 'websocket') {
      // Debug read of the room state (test rig only).
      return new Response(JSON.stringify({ room: this.room, sockets: this.ctx.getWebSockets().length }), { headers: { 'content-type': 'application/json' } });
    }
    if (!this.room) {
      this.room = {
        code, status: 'lobby', playerOrder: [], dealerIndex: 0, currentPlayerIndex: 0, currentRound: 0, currentTrick: 0,
        totalRounds: 0, trumpCard: null, trumpSuit: null, awaitingTrumpChoice: false, bids: {}, tricksWon: {}, cumulativeScores: {},
        trickInProgress: [], roundTricks: [], nextRoundVotes: [], seq: 0,
      };
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [name]);
    server.serializeAttachment({ name });
    const joining = this.room.status === 'lobby' && !this.room.playerOrder.includes(name);
    if (joining) {
      this.room.playerOrder.push(name);
      this.room.cumulativeScores[name] = 0;
    }
    // Full state to the newcomer first (also the reconnect path), then the
    // join goes out to everyone as an ordinary event.
    server.send(JSON.stringify({ t: 'state', seq: this.room.seq, room: publicRoom(this.room), hand: this.hands[name] ?? [] }));
    if (joining) await this.commit({ t: 'join', name, playerOrder: this.room.playerOrder });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.ready;
    const r = this.room!;
    const { name } = ws.deserializeAttachment() as { name: string };
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === 'poke') {
      // Test rig: a no-op event so a reconnecting client can prove its link
      // is back in both directions.
      await this.commit({ t: 'poke', by: name, at: msg.at ?? null });
      return;
    }
    if (msg.t === 'hello') {
      ws.send(JSON.stringify({ t: 'state', seq: r.seq, room: publicRoom(r), hand: this.hands[name] ?? [] }));
      return;
    }
    if (msg.t === 'start' && r.status === 'lobby' && r.playerOrder.length >= 3) {
      r.totalRounds = totalRoundsFor(r.playerOrder.length);
      r.dealerIndex = 0;
      await this.dealRound(1);
      return;
    }
    if (msg.t === 'trump' && r.status === 'dealing' && r.awaitingTrumpChoice && r.playerOrder[r.dealerIndex] === name) {
      r.trumpSuit = msg.suit as Suit;
      r.awaitingTrumpChoice = false;
      r.status = 'bidding';
      await this.commit({ t: 'trump', suit: r.trumpSuit, status: r.status });
      return;
    }
    if (msg.t === 'bid' && r.status === 'bidding' && r.playerOrder[r.currentPlayerIndex] === name) {
      const bid = Number(msg.bid);
      if (!Number.isInteger(bid) || bid < 0 || bid > r.currentRound) return;
      r.bids[name] = bid;
      const all = Object.keys(r.bids).length === r.playerOrder.length;
      if (all) {
        r.status = 'playing';
        r.currentTrick = 1;
        r.currentPlayerIndex = (r.dealerIndex + 1) % r.playerOrder.length;
      } else {
        r.currentPlayerIndex = (r.currentPlayerIndex + 1) % r.playerOrder.length;
      }
      await this.commit({ t: 'bid', player: name, bid, status: r.status, currentPlayerIndex: r.currentPlayerIndex, currentTrick: r.currentTrick });
      return;
    }
    if (msg.t === 'play' && r.status === 'playing' && r.playerOrder[r.currentPlayerIndex] === name) {
      const hand = this.hands[name] ?? [];
      const idx = Number(msg.index);
      const card = hand[idx];
      if (!card || !isLegalPlay(hand, card, r.trickInProgress)) return;
      hand.splice(idx, 1);
      r.trickInProgress.push({ playerName: name, card, playOrder: r.trickInProgress.length });
      const ev: any = { t: 'play', player: name, card, handIndex: idx };
      if (r.trickInProgress.length < r.playerOrder.length) {
        r.currentPlayerIndex = (r.currentPlayerIndex + 1) % r.playerOrder.length;
        ev.currentPlayerIndex = r.currentPlayerIndex;
      } else {
        const wi = winningPlayIndex(r.trickInProgress, r.trumpSuit);
        const winner = r.trickInProgress[wi].playerName;
        r.tricksWon[winner] = (r.tricksWon[winner] ?? 0) + 1;
        r.roundTricks.push({ trickNum: r.currentTrick, plays: r.trickInProgress, winner });
        r.trickInProgress = [];
        const roundDone = r.currentTrick >= r.currentRound;
        if (roundDone) {
          r.status = 'scoring';
        } else {
          r.currentTrick += 1;
          r.currentPlayerIndex = r.playerOrder.indexOf(winner);
        }
        ev.trick = { winner, tricksWon: r.tricksWon, status: r.status, currentTrick: r.currentTrick, currentPlayerIndex: r.currentPlayerIndex };
      }
      await this.commit(ev, name);
      return;
    }
    if (msg.t === 'next' && r.status === 'scoring') {
      if (!r.nextRoundVotes.includes(name)) r.nextRoundVotes.push(name);
      if (r.nextRoundVotes.length >= r.playerOrder.length) {
        // Score the round.
        for (const n of r.playerOrder) r.cumulativeScores[n] = (r.cumulativeScores[n] ?? 0) + calcRoundScore(r.bids[n] ?? 0, r.tricksWon[n] ?? 0);
        const scores = { ...r.cumulativeScores };
        if (r.currentRound >= r.totalRounds) {
          r.status = 'finished';
          r.nextRoundVotes = [];
          await this.commit({ t: 'score', cumulativeScores: scores, status: 'finished' });
        } else {
          await this.commit({ t: 'score', cumulativeScores: scores, status: 'dealing' });
          r.dealerIndex = (r.dealerIndex + 1) % r.playerOrder.length;
          await this.dealRound(r.currentRound + 1);
        }
      } else {
        await this.commit({ t: 'vote', nextRoundVotes: r.nextRoundVotes });
      }
    }
  }

  async webSocketClose() { /* presence would go here */ }

  private async dealRound(round: number) {
    const r = this.room!;
    const d = deal(r.playerOrder, round, shuffle(buildDeck()));
    this.hands = d.hands;
    const last = round >= r.totalRounds;
    const trumpCard = last ? null : d.trumpCard;
    r.currentRound = round;
    r.currentTrick = 0;
    r.trumpCard = trumpCard;
    r.awaitingTrumpChoice = !!trumpCard && trumpCard.kind === 'wizard';
    r.trumpSuit = trumpCard && trumpCard.kind === 'standard' ? trumpCard.suit : null;
    r.status = r.awaitingTrumpChoice ? 'dealing' : 'bidding';
    r.bids = {};
    r.tricksWon = {};
    for (const n of r.playerOrder) r.tricksWon[n] = 0;
    r.trickInProgress = [];
    r.roundTricks = [];
    r.nextRoundVotes = [];
    r.currentPlayerIndex = (r.dealerIndex + 1) % r.playerOrder.length;
    // Each player gets the public deal plus ONLY their own hand.
    r.seq += 1;
    await this.ctx.storage.put({ room: r, hands: this.hands });
    for (const ws of this.ctx.getWebSockets()) {
      const { name } = ws.deserializeAttachment() as { name: string };
      try {
        ws.send(JSON.stringify({ t: 'ev', seq: r.seq, ev: { t: 'deal', round, dealerIndex: r.dealerIndex, currentPlayerIndex: r.currentPlayerIndex, trumpCard, trumpSuit: r.trumpSuit, awaitingTrumpChoice: r.awaitingTrumpChoice, status: r.status, totalRounds: r.totalRounds, hand: this.hands[name] ?? [] } }));
      } catch { /* dead socket */ }
    }
  }

  /** Persist, bump seq, broadcast one small event. The actor of a play also
   *  gets their new hand length implicitly (they know what they played). */
  private async commit(ev: Record<string, unknown>, _actor?: string) {
    const r = this.room!;
    r.seq += 1;
    await this.ctx.storage.put({ room: r, hands: this.hands });
    const frame = JSON.stringify({ t: 'ev', seq: r.seq, ev });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(frame); } catch { /* dead socket */ }
    }
  }
}

export default {
  async fetch(req: Request, env: { ROOMS: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/ws/')) {
      const code = url.pathname.split('/').pop()!;
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(req);
    }
    return new Response(CLIENT_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};

// Minimal client. Same DOM hooks as the real app so scripts/netlab drives it
// unchanged: window.__wizardRoom, button.chip bids, .animate-legal-glow for
// a playable card, "Start game" / "Hearts" / "Next round" buttons.
const CLIENT_HTML = `<!doctype html><meta charset="utf-8"><title>DO Wizard</title>
<style>body{font:14px system-ui;background:#0b1224;color:#eee;margin:16px}button{margin:3px;padding:8px 12px}.card{display:inline-block;border:1px solid #888;border-radius:6px;padding:10px;margin:3px;min-width:44px;text-align:center;background:#182}.animate-legal-glow{outline:3px solid gold}#net{position:fixed;top:8px;right:8px;font-size:12px;opacity:.7}</style>
<div id="net"></div><div id="app"></div>
<script>
(() => {
  const q = new URLSearchParams(location.search);
  const room = q.get('room') || 'TEST'; const name = q.get('name') || 'anon';
  let ws, seq = 0, state = null, hand = [], log = [], backoff = 500, lastPong = 0, timer, lastPoke = null;
  window.__poke = (at) => { send({ t: 'poke', at }); };
  const $ = (h) => { document.getElementById('app').innerHTML = h; };
  const net = (s) => { document.getElementById('net').textContent = s; };
  function expose() {
    if (!state) return;
    // log.length doubles as the shared sequence number so every client's
    // count is comparable (each client only holds the events it has seen).
    window.__wizardRoom = Object.assign({}, state, { log: Array(seq), events: log, hand, seq, lastPoke });
  }
  function apply(ev) {
    const r = state;
    switch (ev.t) {
      case 'join': r.playerOrder = ev.playerOrder; break;
      case 'deal': Object.assign(r, { currentRound: ev.round, dealerIndex: ev.dealerIndex, currentPlayerIndex: ev.currentPlayerIndex, trumpCard: ev.trumpCard, trumpSuit: ev.trumpSuit, awaitingTrumpChoice: ev.awaitingTrumpChoice, status: ev.status, totalRounds: ev.totalRounds, bids: {}, tricksWon: {}, trickInProgress: [], roundTricks: [], nextRoundVotes: [], currentTrick: 0 }); hand = ev.hand; break;
      case 'trump': r.trumpSuit = ev.suit; r.awaitingTrumpChoice = false; r.status = ev.status; break;
      case 'bid': r.bids[ev.player] = ev.bid; r.status = ev.status; r.currentPlayerIndex = ev.currentPlayerIndex; r.currentTrick = ev.currentTrick; break;
      case 'play':
        r.trickInProgress.push({ playerName: ev.player, card: ev.card, playOrder: r.trickInProgress.length });
        if (ev.player === name) hand.splice(ev.handIndex, 1);
        if (ev.trick) { r.roundTricks.push({ trickNum: r.currentTrick, plays: r.trickInProgress, winner: ev.trick.winner }); r.trickInProgress = []; r.tricksWon = ev.trick.tricksWon; r.status = ev.trick.status; r.currentTrick = ev.trick.currentTrick; r.currentPlayerIndex = ev.trick.currentPlayerIndex; }
        else r.currentPlayerIndex = ev.currentPlayerIndex;
        break;
      case 'score': r.cumulativeScores = ev.cumulativeScores; r.status = ev.status; r.nextRoundVotes = []; break;
      case 'vote': r.nextRoundVotes = ev.nextRoundVotes; break;
      case 'poke': lastPoke = { by: ev.by, at: ev.at, seq: seq }; break;
    }
    log.push(ev);
  }
  function render() {
    if (!state) { $('<p>connecting…</p>'); return; }
    const r = state, me = r.playerOrder[r.currentPlayerIndex] === name, dealer = r.playerOrder[r.dealerIndex] === name;
    let h = '<p>room ' + room + ' · ' + name + ' · ' + r.status + ' · round ' + r.currentRound + '/' + r.totalRounds + ' · seq ' + seq + '</p>';
    h += '<p>players: ' + r.playerOrder.join(', ') + '</p>';
    if (r.status === 'lobby') h += '<button id="start">Start game</button>';
    if (r.status === 'dealing' && r.awaitingTrumpChoice && dealer) h += ['Hearts','Diamonds','Clubs','Spades'].map(s => '<button data-suit="' + s[0] + '">' + s + '</button>').join('');
    if (r.status === 'bidding' && me && r.bids[name] === undefined) for (let i = 0; i <= r.currentRound; i++) h += '<button class="chip" data-bid="' + i + '">' + i + '</button>';
    h += '<p>trick: ' + r.trickInProgress.map(p => p.playerName + ':' + label(p.card)).join(' ') + '</p>';
    h += '<div>' + hand.map((c, i) => '<span class="card' + (r.status === 'playing' && me && legal(i) ? ' animate-legal-glow' : '') + '" data-i="' + i + '">' + label(c) + '</span>').join('') + '</div>';
    if (r.status === 'scoring') h += '<p>' + JSON.stringify(r.cumulativeScores) + '</p><button id="next">Next round ' + r.nextRoundVotes.length + '/' + r.playerOrder.length + '</button>';
    if (r.status === 'finished') h += '<h2>finished</h2>';
    $(h);
    const app = document.getElementById('app');
    app.querySelector('#start')?.addEventListener('click', () => send({ t: 'start' }));
    app.querySelector('#next')?.addEventListener('click', () => send({ t: 'next' }));
    app.querySelectorAll('[data-suit]').forEach(b => b.addEventListener('click', () => send({ t: 'trump', suit: b.dataset.suit })));
    app.querySelectorAll('[data-bid]').forEach(b => b.addEventListener('click', () => send({ t: 'bid', bid: Number(b.dataset.bid) })));
    app.querySelectorAll('.animate-legal-glow').forEach(el => el.addEventListener('click', () => { console.log('click card', el.dataset.i); send({ t: 'play', index: Number(el.dataset.i) }); }));
    expose();
  }
  const label = (c) => c.kind === 'wizard' ? 'W' : c.kind === 'jester' ? 'J' : (c.rank > 10 ? 'JQKA'[c.rank - 11] : c.rank) + c.suit;
  function legal(i) {
    // Must follow the lead suit if able; wizards/jesters always fine.
    const plays = state.trickInProgress; const c = hand[i];
    if (c.kind !== 'standard') return true;
    let lead = null; for (const p of plays) { if (p.card.kind === 'wizard') return true; if (p.card.kind === 'standard') { lead = p.card.suit; break; } }
    if (!lead || c.suit === lead) return true;
    return !hand.some(x => x.kind === 'standard' && x.suit === lead);
  }
  function send(m) { console.log('send', JSON.stringify(m), 'ready', ws && ws.readyState, 'seq', seq); if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws/' + room + '?name=' + encodeURIComponent(name));
    ws.onopen = () => { backoff = 500; lastPong = Date.now(); net('online'); send({ t: 'hello', name, seq }); };
    ws.onmessage = (e) => {
      if (e.data === 'pong') { lastPong = Date.now(); return; }
      const m = JSON.parse(e.data);
      if (m.t === 'state') { state = m.room; hand = m.hand; seq = m.seq; render(); return; }
      if (m.t === 'ev') { if (!state) return; if (m.seq <= seq) return; if (m.seq !== seq + 1) { send({ t: 'hello', name, seq }); return; } seq = m.seq; apply(m.ev); render(); }
    };
    ws.onclose = (e) => { console.log('ws close', e.code, e.reason); net('reconnecting…'); setTimeout(connect, backoff); backoff = Math.min(5000, backoff * 2); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  // Keepalive: a link that stops answering is declared dead in ~6 s.
  timer = setInterval(() => { if (!ws || ws.readyState !== 1) return; if (Date.now() - lastPong > 6000) { try { ws.close(); } catch {} return; } ws.send('ping'); }, 3000);
  connect(); render();
})();
</script>`;
