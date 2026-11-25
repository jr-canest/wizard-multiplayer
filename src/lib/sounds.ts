// Game sounds, ported from the scorekeeper (src/utils/sounds.js there) so
// the two apps sound alike: bids are a soft mallet pluck pitched by the
// number, tricks lead with a card snap, a new deal is a riffle that hangs
// on an open fifth and the last bid in lands on C major. Everything is
// synthesized with Web Audio, no files. The phone's silent switch mutes
// Web Audio on iOS, and the game menu has its own Sound toggle.

import { configureAudio, getAudioContext } from './audioKeepAlive';

const PREF_KEY = 'wizard-mp-sound';

let enabled = (() => {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
})();

export function soundEnabled(): boolean {
  return enabled;
}

const listeners = new Set<() => void>();

/** For useSyncExternalStore: every sound switch on screen stays in step. */
export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  listeners.forEach((fn) => fn());
  try {
    // Only the override is stored: no key means the default (on).
    if (on) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, 'off');
  } catch {
    // Private mode: the choice lasts for this page load.
  }
}

// ─── Shared context ───
// Sounds fire several times a second during play, so they share one
// long-lived AudioContext (iOS Safari caps how many a page can open). It
// comes from audioKeepAlive.ts (vendored from Apps/_shared, edit it there):
// revived after the phone sleeps or the app comes back, and replaced inside
// the next tap when iOS leaves it stuck.

type Ctx = AudioContext;
let noiseBuffer: AudioBuffer | null = null;

/**
 * Most sounds here come from other players' moves, not from a tap on this
 * phone, so the context has to be made by an earlier tap: the first tap
 * anywhere makes it, and audioKeepAlive wakes it after every return.
 */
export function unlockAudioOnGesture(): () => void {
  configureAudio({ startOnFirstTap: true });
  return () => {};
}

function play(voice: (ctx: Ctx, dest: AudioNode, t: number) => void): void {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'running') voice(ctx, ctx.destination, ctx.currentTime);
    else if (ctx) {
      // Just resumed by this very call (a tap): start once it is running.
      ctx.resume().then(() => voice(ctx, ctx.destination, ctx.currentTime)).catch(() => {});
    }
  } catch {
    // Audio unavailable: skip silently.
  }
}

const PENTATONIC = [0, 2, 5, 7, 9]; // G A C D E, in semitones above G

function noteFor(n: number): number {
  const step = Math.min(Math.max(n, 0), 12);
  const semitones = Math.floor(step / 5) * 12 + PENTATONIC[step % 5];
  return 392 * 2 ** (semitones / 12); // G4 = 392 Hz
}

// One oscillator note: 4 ms attack, exponential ring-out over `decay` s.
function tone(
  ctx: Ctx,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  t: number,
  peak: number,
  decay: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.02);
  return osc;
}

// Per-sound output level. Each voice disconnects its bus when its longest
// note ends, so a game's worth of sounds does not pile up on the context.
function tapBus(ctx: Ctx, dest: AudioNode, level = 0.25): GainNode {
  const bus = ctx.createGain();
  bus.gain.value = level;
  bus.connect(dest);
  return bus;
}

function getNoiseBuffer(ctx: Ctx): AudioBuffer {
  if (noiseBuffer?.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// Card snap: 40 ms of band-passed noise. Moving the band makes a run of
// snaps (the riffle) sound like different cards.
function cardSnap(ctx: Ctx, dest: AudioNode, t: number, freq = 2800, level = 0.6): AudioBufferSourceNode {
  const snap = ctx.createBufferSource();
  snap.buffer = getNoiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 0.8;
  const snapGain = ctx.createGain();
  snapGain.gain.setValueAtTime(level, t);
  snapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  snap.connect(band);
  band.connect(snapGain);
  snapGain.connect(dest);
  snap.start(t);
  snap.stop(t + 0.05);
  return snap;
}

/** A bid: mallet pluck pitched by the number, so a big bid sounds bigger. */
export function playBidSound(n: number): void {
  play((ctx, dest, t) => {
    const f = noteFor(n);
    const bus = tapBus(ctx, dest);
    const last = tone(ctx, bus, 'sine', f, t, 1, 0.35);
    tone(ctx, bus, 'sine', f * 4, t, 0.35, 0.05);
    last.onended = () => bus.disconnect();
  });
}

/** A card landing on the felt. Other players' cards are a touch softer. */
export function playCardSound(mine: boolean): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest, mine ? 0.25 : 0.17);
    const snap = cardSnap(ctx, bus, t, 2400 + Math.random() * 800);
    snap.onended = () => bus.disconnect();
  });
}

/** You took a trick: snap plus a note pitched by how many you have now. */
export function playTrickWonSound(n: number): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest);
    cardSnap(ctx, bus, t);
    const last = tone(ctx, bus, 'triangle', noteFor(n), t, 0.8, 0.22);
    last.onended = () => bus.disconnect();
  });
}

/** A new deal: a riffle, then an open G fifth ("ready?"). */
export function playStartRoundSound(): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest);
    for (let i = 0; i < 7; i++) {
      const at = t + i * 0.024 + Math.random() * 0.006;
      const freq = 2200 + i * 250 + Math.random() * 300;
      cardSnap(ctx, bus, at, freq, 0.4 + i * 0.06);
    }
    const ring = t + 0.2;
    tone(ctx, bus, 'sine', noteFor(0), ring, 0.6, 0.9);
    tone(ctx, bus, 'sine', noteFor(3), ring, 0.45, 0.9);
    const last = tone(ctx, bus, 'sine', noteFor(5), ring + 0.02, 0.15, 1);
    last.onended = () => bus.disconnect();
  });
}

/** Every bid is in: the mallet rolls up C5 E5 G5 C6. */
export function playBidsInSound(): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest);
    let last: OscillatorNode | null = null;
    [2, 4, 5, 7].forEach((step, i) => {
      const at = t + i * 0.035;
      const f = noteFor(step);
      last = tone(ctx, bus, 'sine', f, at, 0.55, i === 3 ? 0.8 : 0.6);
      tone(ctx, bus, 'sine', f * 4, at, 0.2, 0.05);
    });
    if (last) (last as OscillatorNode).onended = () => bus.disconnect();
  });
}

/** A chat line from someone else: a soft two-note "bloop" up a fourth. */
export function playChatSound(): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest, 0.2);
    tone(ctx, bus, 'sine', 659, t, 0.7, 0.16); // E5
    const last = tone(ctx, bus, 'sine', 880, t + 0.085, 0.8, 0.3); // A5
    last.onended = () => bus.disconnect();
  });
}

/**
 * Your turn: a soft two-tone bell (G5 then D6, each with a quiet octave
 * partial), only when you seem to be looking away (useGameSounds).
 */
export function playYourTurnSound(): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest, 0.22);
    tone(ctx, bus, 'sine', 784, t, 0.8, 0.5);
    tone(ctx, bus, 'sine', 1568, t, 0.18, 0.25);
    const last = tone(ctx, bus, 'sine', 1175, t + 0.14, 0.75, 0.7);
    tone(ctx, bus, 'sine', 2350, t + 0.14, 0.15, 0.3);
    last.onended = () => bus.disconnect();
  });
}

/** You made your bid this round: the bid mallet runs up to a ringing C6. */
export function playBidMadeSound(): void {
  play((ctx, dest, t) => {
    const bus = tapBus(ctx, dest, 0.25);
    let last: OscillatorNode | null = null;
    [5, 7, 9, 10].forEach((step, i) => {
      const at = t + i * 0.07;
      const f = noteFor(step);
      last = tone(ctx, bus, 'sine', f, at, 0.6, i === 3 ? 1.1 : 0.4);
      tone(ctx, bus, 'sine', f * 2, at, 0.15, 0.2);
    });
    if (last) (last as OscillatorNode).onended = () => bus.disconnect();
  });
}

/** Game over: magical ascending chime (C5 → E5 → G5 → C6) with a shimmer. */
export function playSparkleSound(): void {
  play((ctx, dest, now) => {
    const bus = tapBus(ctx, dest, 1);
    const notes = [523, 659, 784, 1047];
    const noteSpacing = 0.12;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * noteSpacing);
      gain.gain.setValueAtTime(0, now + i * noteSpacing);
      gain.gain.linearRampToValueAtTime(0.3, now + i * noteSpacing + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * noteSpacing + 0.5);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(now + i * noteSpacing);
      osc.stop(now + i * noteSpacing + 0.5);
    });
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'triangle';
    shimmer.frequency.setValueAtTime(2093, now + 0.3);
    shimmer.frequency.exponentialRampToValueAtTime(4186, now + 1.2);
    shimmerGain.gain.setValueAtTime(0, now + 0.3);
    shimmerGain.gain.linearRampToValueAtTime(0.15, now + 0.5);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(bus);
    shimmer.start(now + 0.3);
    shimmer.stop(now + 1.5);
    shimmer.onended = () => bus.disconnect();
  });
}

/** Shame point: the scorekeeper's boo (two detuned saws sliding down). */
export function playBooSound(): void {
  play((ctx, dest, t) => {
    const duration = 0.8;
    const bus = tapBus(ctx, dest, 0.7);
    const gain = ctx.createGain();
    const distortion = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 200 * x) / (Math.PI + 200 * Math.abs(x));
    }
    distortion.curve = curve;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(180, t);
    osc1.frequency.exponentialRampToValueAtTime(80, t + duration);
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(120, t);
    osc2.frequency.exponentialRampToValueAtTime(60, t + duration);
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, t + duration);
    osc1.connect(distortion);
    osc2.connect(distortion);
    distortion.connect(gain);
    gain.connect(bus);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + duration);
    osc2.stop(t + duration);
    osc1.onended = () => bus.disconnect();
  });
}
