/**
 * audioKeepAlive: keeps Web Audio and <audio> elements working after a phone sleeps, locks, takes a
 * call, or the web app goes to the background and comes back.
 *
 * CANONICAL COPY: Apps/_shared/audioKeepAlive.ts (Jorge's Dropbox). Every app with sound vendors an
 * identical copy. Edit the canonical file, then run Apps/_shared/sync-audio-keep-alive.sh, which
 * copies it into every app listed there (and `--check` reports copies that drifted).
 *
 * Why: iOS Safari suspends the AudioContext when the page is hidden and marks it 'interrupted' after
 * the lock screen or a call. resume() only sticks from inside a user gesture, a resumed context stays
 * mute until something plays, and sometimes it never comes back at all ('interrupted' for good, or
 * 'running' with a frozen clock), so every sound is silent until the app is reloaded.
 * Built from Math Review's lib/audioContext.ts (2026-10-29) and Jam Jar's rebuild-on-return (10/10).
 *
 * What it does:
 * - one shared AudioContext, made on first use (or on the first tap with startOnFirstTap)
 * - revives it on every tap or key (capture phase, so it runs before the app's own handlers) and, once
 *   it has played, on visibilitychange, pageshow, focus and statechange; then plays a one-sample
 *   silent buffer (wakes iOS output)
 * - on the first tap after the page was hidden, a context that is still stuck (interrupted, closed,
 *   not running, or running with a frozen clock) is replaced by a fresh one made inside that tap;
 *   onAudioContext() tells the app so it can rebuild nodes and buffers it keeps
 * - watchMedia(el): reloads an <audio>/<video> whose media iOS dropped while asleep (same spot,
 *   paused) and nudges one that claims to be playing but whose clock is stuck
 *
 * Rules for apps: call getAudioContext() each time a sound plays (the context can be replaced, so
 * never hold on to it), and never suspend() or close() it yourself.
 */

type AnyState = AudioContextState | 'interrupted';
type Ctor = typeof AudioContext;
type Listener = (ctx: AudioContext, old: AudioContext | null) => void;

let ctx: AudioContext | null = null;
let create: (() => AudioContext) | null = null;
let startOnFirstTap = false;
let installed = false;
let wasHidden = false; // the page was hidden since the last tap
let frozen = false; // 'running' after coming back, but its clock did not move
let madeAt = 0; // when the current context was made (one tap fires several events: replace once)
const listeners = new Set<Listener>();
const media = new Set<HTMLMediaElement>();
const mediaAt = new WeakMap<HTMLMediaElement, number>();

function ctor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const stateOf = (c: AudioContext) => c.state as AnyState;

/** iOS keeps a resumed context muted until something actually plays: a one-sample silent buffer does it. */
function blip(c: AudioContext) {
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
}

const ran = new WeakSet<AudioContext>(); // contexts that have played: iOS lets those resume without a tap

/** Inside a tap or key (or just after one)? Browsers without userActivation count as yes. */
function inTap(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : true;
}

function wake(c: AudioContext, tap = inTap()) {
  const s = stateOf(c);
  if (s !== 'suspended' && s !== 'interrupted') return;
  // Outside a tap, only a context that already ran, on a visible page: playing or resuming on a
  // never-started context flips it to 'interrupted' (iOS 27), and resuming behind other apps keeps
  // the audio on there.
  if (!tap && (!ran.has(c) || document.visibilityState === 'hidden')) return;
  c.resume().then(() => blip(c)).catch(() => {});
}

/** A brand-new context (the first one, or a replacement for a stuck or closed one). */
function fresh(): AudioContext | null {
  const AC = ctor();
  let c: AudioContext;
  try {
    if (create) c = create();
    else if (AC) c = new AC();
    else return null;
  } catch { return null; }
  const old = ctx;
  ctx = c;
  madeAt = Date.now();
  wasHidden = false; // a fresh context has nothing to recover from
  frozen = false;
  if (c.state === 'running') ran.add(c);
  c.addEventListener('statechange', () => {
    if (stateOf(c) === 'running') ran.add(c);
    // iOS interrupts a visible page too (Siri, a call, another app's audio): try to come back on our
    // own. Not at once: going to the background also reports 'interrupted' ~0.2 s before the page is
    // hidden, and resuming then keeps the context running behind other apps (iOS 27 simulator, 11/2).
    setTimeout(() => {
      if (c === ctx && document.visibilityState === 'visible' && stateOf(c) !== 'running') wake(c);
    }, 800);
  });
  listeners.forEach((fn) => { try { fn(c, old); } catch (e) { console.error(e); } });
  if (old && stateOf(old) !== 'closed') old.close().catch(() => {});
  if (inTap()) blip(c);
  return c;
}

/** Tap or key, capture phase: the one moment iOS lets audio start, so revive or replace here. */
function onGesture() {
  let c = ctx;
  if (!c) {
    if (startOnFirstTap) c = fresh();
    if (c) wake(c, true);
    return;
  }
  const s = stateOf(c);
  const stuck = s === 'interrupted' || (wasHidden && (s !== 'running' || frozen));
  if (s === 'closed' || (stuck && Date.now() - madeAt > 1000)) c = fresh();
  wasHidden = false;
  frozen = false;
  if (c) wake(c, true);
}

function onHidden() {
  wasHidden = true;
  media.forEach((el) => mediaAt.set(el, el.currentTime));
}

function onBack() {
  const c = ctx;
  if (c) {
    if (stateOf(c) === 'closed') fresh();
    else wake(c);
    // Running but frozen (iOS after the lock screen): the next tap replaces it.
    const t0 = c.currentTime;
    setTimeout(() => {
      if (c === ctx && stateOf(c) === 'running' && c.currentTime - t0 < 0.1) frozen = true;
    }, 600);
  }
  media.forEach(reviveMedia);
}

function reviveMedia(el: HTMLMediaElement) {
  if (el.error && el.currentSrc) {
    // iOS dropped the media while asleep: load it again at the same spot (paused, nothing autoplays)
    const at = mediaAt.get(el) ?? 0;
    el.load();
    if (at > 0) el.addEventListener('loadedmetadata', () => { el.currentTime = at; }, { once: true });
    return;
  }
  if (el.paused || el.ended) return;
  const t0 = el.currentTime;
  setTimeout(() => {
    // says it is playing, has data, but the clock is stuck: pause and play again (this element was
    // already started by a tap, so iOS allows play() without one)
    if (!el.paused && !el.ended && el.readyState >= 3 && el.currentTime === t0) {
      el.pause();
      el.play().catch(() => {});
    }
  }, 1000);
}

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onBack();
  });
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('pageshow', onBack);
  window.addEventListener('focus', () => { if (ctx) wake(ctx); });
  // A touch pointerdown is not a gesture iOS lets audio start from (a mouse one is); pointerup,
  // touchend and keydown are.
  const opts = { capture: true, passive: true };
  document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') onGesture(); }, opts);
  for (const ev of ['pointerup', 'touchend', 'keydown'] as const) document.addEventListener(ev, onGesture, opts);
}

/**
 * Optional, call once at startup before any sound.
 * - create: how to make the context (e.g. a latencyHint, or wrapping decodeAudioData)
 * - startOnFirstTap: make the context on the first tap anywhere, for apps whose sounds are set off
 *   by timers or other players rather than by a tap on this device
 */
export function configureAudio(opts: { create?: () => AudioContext; startOnFirstTap?: boolean }): void {
  if (opts.create) create = opts.create;
  if (opts.startOnFirstTap) startOnFirstTap = true;
  install();
}

/** The shared context, made on first use and revived if the browser suspended it. Null if no Web Audio. */
export function getAudioContext(): AudioContext | null {
  install();
  if (!ctx || stateOf(ctx) === 'closed') fresh();
  if (ctx) wake(ctx);
  return ctx;
}

/** Call inside a tap handler to start or revive audio right now (the capture listener usually already did). */
export function unlockAudio(): AudioContext | null {
  install();
  if (!ctx) fresh();
  onGesture();
  return ctx;
}

/** A brand-new context right now (call inside a tap so iOS lets it start), e.g. after using the mic. */
export function replaceAudioContext(): AudioContext | null {
  install();
  const c = fresh();
  if (c) wake(c, true);
  return c;
}

/** Runs every time a new context is made (first one: old is null). Rebuild cached nodes or buffers here. */
export function onAudioContext(fn: Listener): () => void {
  install();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Looks after an <audio> or <video> element across sleep and backgrounding. Returns an unwatch function. */
export function watchMedia(el: HTMLMediaElement): () => void {
  install();
  media.add(el);
  return () => { media.delete(el); };
}
