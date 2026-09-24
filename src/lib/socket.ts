/**
 * The phone's link to its room on the game server. One connection per room
 * code, shared by every hook and action in the app.
 *
 * Plane-grade on purpose: a ping every 3 s, a link declared dead after 7 s
 * of silence and reconnected with a short back-off, a full snapshot on
 * every (re)connect so nothing has to be replayed, and actions that wait
 * for the server's answer instead of guessing. The UI never sees any of
 * this; it sees the same room snapshot shape it always did.
 */
import { gameWsUrl } from './server';
import { readToken } from './session';
import type { Card, RoomDoc } from './types';
import type { EngineErrorCode } from '../game/engine';

export type RoomSnapshot = RoomDoc & { code: string };
export type PlayerSnapshot = {
  name: string;
  isBot?: boolean;
  connected: boolean;
  /** Epoch ms the server last heard from this player. */
  lastSeen: number;
  voteKickAgainst: string | null;
};
export type ChatLine = { player: string; text: string; ts: number; w: string; cts?: number };

export type ConnectionState = {
  room: RoomSnapshot | null;
  hand: Card[] | null;
  players: PlayerSnapshot[];
  chat: ChatLine[];
  /** 'connecting' until the first snapshot; 'online' while the socket is
   *  up; 'reconnecting' after it dropped; 'closed' after a fatal error. */
  link: 'connecting' | 'online' | 'reconnecting' | 'closed';
  /** Set when the server refused us (roomNotFound, gameStarted, ...). */
  error: string | null;
};

export class ActionError extends Error {
  code: EngineErrorCode | 'offline' | 'timeout' | 'failed';
  constructor(code: ActionError['code']) {
    super(code);
    this.code = code;
  }
}

type Listener = (s: ConnectionState) => void;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number };

const PING_EVERY_MS = 3000;
const DEAD_AFTER_MS = 7000;
const ACK_TIMEOUT_MS = 20_000;

export class RoomConnection {
  state: ConnectionState = { room: null, hand: null, players: [], chat: [], link: 'connecting', error: null };
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, Pending>();
  private backoff = 500;
  private lastHeard = 0;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private closed = false;
  private seq = 0;
  readonly code: string;
  private join: boolean;
  /** The seat token this socket presents. Passed in, not read from
   *  storage: right after sign-in the token is in React state before the
   *  provider's effect has persisted it. */
  readonly token: string | null;

  constructor(code: string, join: boolean, token: string | null) {
    this.code = code;
    this.join = join;
    this.token = token;
    this.connect();
    this.pingTimer = window.setInterval(() => this.tick(), PING_EVERY_MS);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  /** Send one game action and wait for the server's verdict. */
  act<T = unknown>(action: string, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) { reject(new ActionError('offline')); return; }
      const id = `${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new ActionError('timeout'));
      }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      const frame = JSON.stringify({ t: 'act', id, action, args });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
      else this.queue.push(frame); // flushed on reconnect, within the ack timeout
    });
  }
  private queue: string[] = [];

  close(): void {
    this.closed = true;
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    try { this.ws?.close(); } catch { /* already gone */ }
    for (const p of this.pending.values()) { window.clearTimeout(p.timer); p.reject(new ActionError('offline')); }
    this.pending.clear();
  }

  // ─── internals ────────────────────────────────────────────────────────
  private set(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private connect(): void {
    if (this.closed) return;
    const token = this.token ?? readToken();
    if (!token) { this.set({ link: 'closed', error: 'unauthorized' }); return; }
    let ws: WebSocket;
    try { ws = new WebSocket(gameWsUrl(this.code, token)); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.lastHeard = Date.now();
      this.backoff = 500;
      ws.send(JSON.stringify({ t: 'hello', join: this.join }));
    };
    ws.onmessage = (ev) => {
      this.lastHeard = Date.now();
      if (ev.data === 'pong') return;
      let msg: { t: string; [k: string]: unknown };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.t === 'state') {
        const patch: Partial<ConnectionState> = {
          room: msg.room as RoomSnapshot,
          hand: (msg.hand as Card[] | null) ?? null,
          players: (msg.players as PlayerSnapshot[]) ?? [],
          link: 'online',
          error: null,
        };
        if (Array.isArray(msg.chat)) patch.chat = msg.chat as ChatLine[];
        const wasFirst = this.state.link !== 'online';
        this.set(patch);
        if (wasFirst) for (const f of this.queue.splice(0)) ws.send(f);
        return;
      }
      if (msg.t === 'chat') { this.set({ chat: [...this.state.chat, msg.msg as ChatLine].slice(-200) }); return; }
      if (msg.t === 'ack') {
        const p = this.pending.get(String(msg.id));
        if (!p) return;
        this.pending.delete(String(msg.id));
        window.clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new ActionError((msg.code as ActionError['code']) ?? 'failed'));
        return;
      }
      if (msg.t === 'error') {
        // The server refused this socket for a reason that will not change
        // by retrying (no such room, game already started, bad token).
        this.closed = true;
        this.set({ link: 'closed', error: String(msg.code) });
        for (const p of this.pending.values()) { window.clearTimeout(p.timer); p.reject(new ActionError('failed')); }
        this.pending.clear();
      }
    };
    ws.onclose = () => { if (this.ws === ws) this.scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.ws = null;
    if (this.state.link !== 'connecting') this.set({ link: 'reconnecting' });
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(4000, this.backoff * 2);
  }

  private tick(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastHeard > DEAD_AFTER_MS) { try { ws.close(); } catch { /* noop */ } return; }
    ws.send('ping');
  }

  /** Wi-Fi came back or the phone woke: do not wait for the back-off. */
  private onOnline = () => { this.backoff = 500; if (!this.ws) { if (this.reconnectTimer !== null) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } this.connect(); } };
  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    // A socket that slept with the phone may be dead without saying so.
    if (this.ws && Date.now() - this.lastHeard > DEAD_AFTER_MS) { try { this.ws.close(); } catch { /* noop */ } }
    else this.onOnline();
  };
}

// One live connection per code, reference-counted by the hooks.
const connections = new Map<string, { conn: RoomConnection; refs: number }>();

export function acquireConnection(code: string, join = true, token: string | null = readToken()): RoomConnection {
  let entry = connections.get(code);
  // A connection made without a token (page opened before sign-in, or a
  // session from before seat tokens existed), or with a different one, is
  // replaced once the right token is there; the reference count carries
  // over so releases still balance.
  const replace = entry && token && entry.conn.token !== token;
  if (!entry || replace) {
    const refs = entry?.refs ?? 0;
    entry?.conn.close();
    entry = { conn: new RoomConnection(code, join, token), refs };
    connections.set(code, entry);
  }
  entry.refs += 1;
  return entry.conn;
}

export function releaseConnection(code: string): void {
  const entry = connections.get(code);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    // Linger a moment so a route change inside the room does not drop the
    // socket and force a full resync.
    window.setTimeout(() => {
      const e = connections.get(code);
      if (e && e.refs <= 0) { e.conn.close(); connections.delete(code); }
    }, 1500);
  }
}

/** The connection a component already holds, for actions. */
export function connectionFor(code: string): RoomConnection {
  const entry = connections.get(code);
  if (entry) return entry.conn;
  return acquireConnection(code, false, readToken());
}

/** Chat lines an open connection already holds, so a reader mounted
 *  mid-game starts with them instead of one empty render. */
export function peekChat(code: string): ChatLine[] {
  return connections.get(code)?.conn.state.chat ?? [];
}
