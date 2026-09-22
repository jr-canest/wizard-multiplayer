// Wizard game server. One Durable Object per room owns the whole game
// (src/game/engine.ts), talks to each phone over a hibernating WebSocket,
// runs the computer players and the vote clocks on alarms, and tells every
// socket about every change with a full snapshot (small: the room only
// carries the current round). Hands go to their owner only.
import * as E from '../../src/game/engine';
import type { EngineState, Presence } from '../../src/game/engine';
import { hashPin, lookupPlayer, mintToken, verifyToken, type Env } from './auth';

export { type Env };

// ─── wire format ─────────────────────────────────────────────────────────
// client → server
//   { t: 'hello', token, join?: boolean }         first message on a socket
//   { t: 'act', id, action, args }                 one game action, acked
// server → client
//   { t: 'state', seq, room, hand, players, chat? }  full snapshot (+chat on hello)
//   { t: 'chat', msg }                              one new chat line
//   { t: 'ack', id, ok: true, result? } | { t: 'ack', id, ok: false, code }
//   { t: 'error', code }                            hello failed; socket closes

type PlayerPresence = { name: string; isBot?: boolean; connected: boolean; lastSeen: number; voteKickAgainst: string | null };

const BOT_ACTION_DELAY_MS = 250;
const BOT_NEW_TRICK_DELAY_MS = 1400;

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = origin && allowed.includes(origin) ? origin : allowed[0];
  return { 'access-control-allow-origin': ok, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization', 'vary': 'origin' };
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Name + PIN → seat token. The PIN check is the same SHA-256(salt:pin)
    // the app has always stored; the player doc must already exist (the
    // app creates it on first sign-in, as before).
    if (url.pathname === '/session' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { name?: string; pin?: string } | null;
      const name = (body?.name ?? '').trim();
      const pin = body?.pin ?? '';
      if (!name || !/^\d{4}$/.test(pin)) return json({ error: 'badRequest' }, 400, cors);
      const player = await lookupPlayer(env, name);
      if (!player?.pinHash || !player.pinSalt) return json({ error: 'unknownPlayer' }, 404, cors);
      if ((await hashPin(pin, player.pinSalt)) !== player.pinHash) return json({ error: 'wrongPin' }, 401, cors);
      // Use the canonical spelling from the player doc so seats match History.
      const canonical = player.name ?? name;
      return json({ token: await mintToken(env, canonical), name: canonical }, 200, cors);
    }

    // Create a room. The DO for the new code initialises itself.
    if (url.pathname === '/rooms' && req.method === 'POST') {
      const session = await verifyToken(env, req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null);
      if (!session) return json({ error: 'unauthorized' }, 401, cors);
      const body = (await req.json().catch(() => ({}))) as { canadianRule?: boolean; withBots?: boolean };
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = E.createState({ hostName: session.name, canadianRule: body.canadianRule !== false, withBots: !!body.withBots });
        const stub = env.ROOMS.get(env.ROOMS.idFromName(state.room.code));
        const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify(state) });
        if (res.status === 409) continue; // code already taken, try another
        if (!res.ok) return json({ error: 'createFailed' }, 500, cors);
        return json({ code: state.room.code }, 200, cors);
      }
      return json({ error: 'codeCollision' }, 500, cors);
    }

    // The socket. /ws/ABCD?token=...
    const m = url.pathname.match(/^\/ws\/([A-Z0-9]{4})$/);
    if (m) {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(req);
    }
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    return json({ error: 'notFound' }, 404, cors);
  },
};

export class RoomDO {
  private state: EngineState | null = null;
  private ready: Promise<void>;
  private lastSeen = new Map<string, number>();

  constructor(private ctx: DurableObjectState, private env: Env) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<EngineState>('state')) ?? null;
      this.lastSeen = new Map(Object.entries((await ctx.storage.get<Record<string, number>>('lastSeen')) ?? {}));
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ─── HTTP into the object ─────────────────────────────────────────────
  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.state) return new Response('exists', { status: 409 });
      this.state = (await req.json()) as EngineState;
      await this.persist();
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const session = await verifyToken(this.env, url.searchParams.get('token'));
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Accept first so we can answer over the socket; hello does the rest.
    this.ctx.acceptWebSocket(server, session ? [session.name] : []);
    server.serializeAttachment({ name: session?.name ?? null, authed: !!session });
    if (!session) { server.send(JSON.stringify({ t: 'error', code: 'unauthorized' })); server.close(4001, 'unauthorized'); }
    else if (!this.state) { server.send(JSON.stringify({ t: 'error', code: 'roomNotFound' })); server.close(4004, 'roomNotFound'); }
    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── socket lifecycle ─────────────────────────────────────────────────
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const att = ws.deserializeAttachment() as { name: string | null; authed: boolean };
    if (!att.authed || !att.name || !this.state) return;
    let msg: { t?: string; id?: string; action?: string; args?: unknown[]; join?: boolean };
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const name = att.name;
    this.lastSeen.set(name, Date.now());

    if (msg.t === 'hello') {
      if (msg.join) {
        try { E.join(this.state, name); } catch (err) {
          ws.send(JSON.stringify({ t: 'error', code: (err as E.EngineError).code ?? 'joinFailed' }));
          return;
        }
      }
      await this.persist();
      // The newcomer gets the snapshot + chat; everyone else sees presence.
      ws.send(JSON.stringify({ ...this.snapshotFor(name), chat: this.state.chat }));
      this.broadcast(name);
      await this.schedule();
      return;
    }

    if (msg.t === 'act' && typeof msg.id === 'string' && typeof msg.action === 'string') {
      const args = Array.isArray(msg.args) ? msg.args : [];
      try {
        const result = await this.perform(name, msg.action, args);
        ws.send(JSON.stringify({ t: 'ack', id: msg.id, ok: true, result }));
      } catch (err) {
        const code = err instanceof E.EngineError ? err.code : 'failed';
        ws.send(JSON.stringify({ t: 'ack', id: msg.id, ok: false, code }));
        return;
      }
      await this.persist();
      this.broadcast();
      await this.schedule();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ready;
    const att = ws.deserializeAttachment() as { name: string | null };
    if (att.name) this.lastSeen.set(att.name, Date.now());
    await this.persist();
    this.broadcast();
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }

  // ─── actions ──────────────────────────────────────────────────────────
  private async perform(name: string, action: string, args: unknown[]): Promise<unknown> {
    const s = this.state!;
    const now = Date.now();
    const str = (i: number) => String(args[i] ?? '');
    const num = (i: number) => Number(args[i]);
    const bool = (i: number) => Boolean(args[i]);
    switch (action) {
      case 'leave': E.leave(s, name); return null;
      case 'addBot': return E.addBot(s, name, str(0) as 'easy' | 'medium' | 'expert');
      case 'removeBot': E.removeBot(s, name, str(0)); return null;
      case 'setChosenTotalRounds': E.setChosenTotalRounds(s, name, args[0] === null ? null : num(0)); return null;
      case 'startGame': E.startGame(s, name); return null;
      case 'chooseTrumpSuit': E.chooseTrumpSuit(s, name, str(0) as 'H' | 'D' | 'C' | 'S'); return null;
      case 'placeBid': E.placeBid(s, name, num(0)); return null;
      case 'playCard': E.playCard(s, name, num(0)); return null;
      case 'voteNextRound': E.voteNextRound(s, name, bool(0)); return null;
      case 'openRoundVote': E.openRoundVote(s, name, str(0) as 'lastRound' | 'endGame', now); return null;
      case 'castRoundVote': E.castRoundVote(s, name, bool(0)); return null;
      case 'cancelRoundVote': E.cancelRoundVote(s, name); return null;
      case 'requestUndo': E.requestUndo(s, name, now); return null;
      case 'voteUndo': E.voteUndo(s, name, bool(0)); return null;
      case 'votePlayAgain': E.votePlayAgain(s, name, bool(0)); return null;
      case 'resetForNewGame': E.hostReset(s, name); return null;
      case 'claimAiSummary': return E.claimAiSummary(s);
      case 'setSharedAiSummary': E.setAiSummary(s, str(0)); return null;
      case 'claimHistory': return E.claimHistory(s);
      case 'markHistorySaved': E.markHistorySaved(s, args[0] === null ? null : str(0)); return null;
      case 'postReaction': E.postReaction(s, name, str(0), now); return null;
      case 'sendChat': {
        const msg = E.sendChat(s, name, str(0), now, Number.isFinite(num(1)) ? num(1) : undefined);
        if (msg) for (const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify({ t: 'chat', msg })); } catch { /* gone */ } }
        return null;
      }
      case 'setVoteKick': {
        const target = args[0] === null ? null : str(0);
        E.setVoteKick(s, name, target);
        if (target) {
          const tally = E.kickTally(s, target, this.presence());
          if (tally.votes >= tally.needed) E.executeKick(s, target);
        }
        return null;
      }
      default: throw new E.EngineError('notSeated');
    }
  }

  // ─── alarms: computer moves and vote clocks ───────────────────────────
  private async schedule(): Promise<void> {
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    const due: number[] = [];
    const bot = E.pendingBot(s);
    if (bot) due.push(now + (bot.leadingNewTrick ? BOT_NEW_TRICK_DELAY_MS : BOT_ACTION_DELAY_MS));
    const exp = E.nextExpiry(s);
    if (exp !== null) due.push(exp);
    if (due.length) await this.ctx.storage.setAlarm(Math.min(...due));
  }

  async alarm(): Promise<void> {
    await this.ready;
    const s = this.state;
    if (!s) return;
    let changed = E.expireVotes(s, Date.now());
    const bot = E.pendingBot(s);
    if (bot) {
      try { E.botAct(s, bot); changed = true; } catch (err) { console.warn('[bot]', bot.name, bot.kind, (err as Error).message); }
    }
    if (changed) { await this.persist(); this.broadcast(); }
    await this.schedule();
  }

  // ─── snapshots ────────────────────────────────────────────────────────
  /** Sockets that are actually open. A socket in its close handler is
   *  still listed by the runtime, so it is filtered by state. */
  private presence(): Presence {
    const open = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1 /* OPEN */) continue;
      const att = ws.deserializeAttachment() as { name: string | null };
      if (att.name) open.add(att.name);
    }
    return { connected: (n) => open.has(n) || E.isBot(this.state!.room, n) };
  }

  private players(): PlayerPresence[] {
    const s = this.state!;
    const p = this.presence();
    return s.room.playerOrder.map((name) => ({
      name,
      isBot: E.isBot(s.room, name) || undefined,
      connected: p.connected(name),
      lastSeen: E.isBot(s.room, name) ? Date.now() : (this.lastSeen.get(name) ?? 0),
      voteKickAgainst: s.kickVotes[name] ?? null,
    }));
  }

  private snapshotFor(name: string) {
    const s = this.state!;
    return { t: 'state', seq: Date.now(), room: E.publicRoom(s), hand: s.hands[name] ?? null, players: this.players() };
  }

  /** Everyone gets the room; each socket gets its own hand. */
  private broadcast(except?: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { name: string | null; authed: boolean };
      if (!att.authed || !att.name || att.name === except) continue;
      try { ws.send(JSON.stringify(this.snapshotFor(att.name))); } catch { /* gone */ }
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put({ state: this.state, lastSeen: Object.fromEntries(this.lastSeen) });
  }
}
