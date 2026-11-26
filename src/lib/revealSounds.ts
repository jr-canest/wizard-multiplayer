// Sounds for the round-results reveal (2026-11-26): a coin tick as the
// points land, a whoosh as the rows change places, a bright rise for the
// cheer, a short sad slide for the roast. Synthesized, no files, quiet
// enough to sit under the table talk. SHARED VERBATIM with the scorekeeper
// (src/utils/revealSounds.ts there): edit one, copy to the other.
import { getAudioContext } from './audioKeepAlive';

type Ctx = BaseAudioContext;
type Voice = (ctx: Ctx, dest: AudioNode, t: number) => void;

let gate: () => boolean = () => true;
/** The app's own Sound switch, if it has one. */
export function setRevealSoundGate(fn: () => boolean): void {
  gate = fn;
}

function emit(voice: Voice): void {
  if (!gate()) return;
  // Test recordings collect every sound here to rebuild the soundtrack.
  (globalThis as { __wizardSoundLog?: Array<{ at: number; voice: Voice }> }).__wizardSoundLog?.push({ at: performance.now(), voice });
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'running') voice(ctx, ctx.destination, ctx.currentTime);
    else if (ctx) ctx.resume().then(() => voice(ctx, ctx.destination, ctx.currentTime)).catch(() => {});
  } catch {
    // Audio unavailable: skip silently.
  }
}

function note(ctx: Ctx, dest: AudioNode, type: OscillatorType, freq: number, t: number, peak: number, decay: number, slideTo?: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + decay);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.03);
}

/** The round's points land: two quick coin pings. */
export function playRevealPoints(): void {
  emit((ctx, dest, t) => {
    note(ctx, dest, 'sine', 1319, t, 0.11, 0.16);
    note(ctx, dest, 'sine', 1760, t + 0.07, 0.1, 0.22);
    note(ctx, dest, 'triangle', 2637, t + 0.07, 0.03, 0.12);
  });
}

/** Rows change places: a soft whoosh (filtered noise sweeping up). */
export function playRevealMove(): void {
  emit((ctx, dest, t) => {
    const len = Math.ceil(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(350, t);
    band.frequency.exponentialRampToValueAtTime(2600, t + 0.42);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(band);
    band.connect(gain);
    gain.connect(dest);
    src.start(t);
    src.stop(t + 0.6);
    // The row lands.
    note(ctx, dest, 'sine', 196, t + 0.5, 0.12, 0.14, 130);
  });
}

/** The cheer: a bright three-note rise. */
export function playQuipCheer(): void {
  emit((ctx, dest, t) => {
    // Done inside 0.45 s: the next sound is the second line's, 0.6 s on.
    [784, 988, 1319].forEach((f, i) => {
      note(ctx, dest, 'triangle', f, t + i * 0.07, 0.12, i === 2 ? 0.3 : 0.14);
      note(ctx, dest, 'sine', f * 2, t + i * 0.07, 0.03, 0.12);
    });
  });
}

/** The roast: two falling notes, the second one sagging (a small "wah waah"). */
export function playQuipRoast(): void {
  emit((ctx, dest, t) => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(dest);
    // Done inside 0.5 s, before the points ping.
    note(ctx, lp, 'sawtooth', 311, t, 0.1, 0.15, 294);
    note(ctx, lp, 'sawtooth', 262, t + 0.16, 0.11, 0.32, 196);
  });
}

/** A line about the whole table: a neutral double blip. */
export function playQuipTable(): void {
  emit((ctx, dest, t) => {
    note(ctx, dest, 'sine', 659, t, 0.1, 0.12);
    note(ctx, dest, 'sine', 659, t + 0.11, 0.1, 0.18);
  });
}

/** The sound for one commentary line, by its tone. */
export function playQuip(tone: 'up' | 'down' | 'all'): void {
  if (tone === 'up') playQuipCheer();
  else if (tone === 'down') playQuipRoast();
  else playQuipTable();
}
