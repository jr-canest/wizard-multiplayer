/** Magical ascending chime (C5 → E5 → G5 → C6) plus a high shimmer overlay. */
export function playSparkleSound(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

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
      gain.connect(ctx.destination);
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
    shimmerGain.connect(ctx.destination);
    shimmer.start(now + 0.3);
    shimmer.stop(now + 1.5);

    setTimeout(() => ctx.close(), 2000);
  } catch {
    // Audio unavailable — skip silently.
  }
}
