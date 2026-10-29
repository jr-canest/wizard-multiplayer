import { useEffect, useMemo, useState } from 'react';

// The game-over moment (2026-10-29, replaced the white wipe + emoji
// sparkles): a warm gold glow washes down from the top of the screen, the
// app's own crown (the gold disc with ♛, as on the dealer badge and the
// winning trick card) drops onto the winner's name, gold flecks drift off
// it, and the standings count up from last place to first. A soft glow
// stays behind the name afterwards. CSS only; all timings in ms from the
// moment the final screen mounts.
export const CROWN_LANDS_MS = 700;
/** When the standings start counting (last place first). */
export const STANDINGS_START_MS = 1000;
export const STANDINGS_STEP_MS = 260;

const KEYFRAMES = `
@keyframes wm-wash {
  0% { opacity: 0; }
  25% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes wm-crown-drop {
  0% { opacity: 0; transform: translateY(-80px) rotate(-16deg) scale(.9); }
  55% { opacity: 1; }
  78% { transform: translateY(4px) rotate(3deg) scale(1.04); }
  100% { opacity: 1; transform: none; }
}
@keyframes wm-halo {
  0% { opacity: 0; transform: scale(.4); }
  35% { opacity: 1; transform: scale(1.1); }
  100% { opacity: .55; transform: scale(1); }
}
@keyframes wm-fleck {
  0% { opacity: 0; transform: translate(0, 0) rotate(45deg) scale(.4); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(225deg) scale(1); }
}
@keyframes wm-title-in {
  0% { opacity: 0; letter-spacing: .2em; }
  100% { opacity: 1; letter-spacing: normal; }
}
@keyframes wm-row-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
@keyframes wm-row-glow {
  0%, 100% { box-shadow: 0 0 0 rgba(226,197,121,0); }
  40% { box-shadow: 0 0 22px rgba(226,197,121,.45); }
}
.wm-crown-drop { animation: wm-crown-drop 650ms cubic-bezier(.3,1.2,.5,1) ${CROWN_LANDS_MS - 520}ms backwards; }
.wm-halo { animation: wm-halo 1600ms ease-out 250ms backwards; }
.wm-title-in { animation: wm-title-in 700ms ease-out 200ms backwards; }
.wm-fleck { animation: wm-fleck var(--dur) ease-out var(--delay) both; }
.wm-row-in { animation: wm-row-in 450ms cubic-bezier(.2,.7,.3,1) backwards; }
.wm-row-glow { animation: wm-row-in 450ms cubic-bezier(.2,.7,.3,1) backwards, wm-row-glow 1400ms ease-out backwards; }
@media (prefers-reduced-motion: reduce) {
  .wm-crown-drop, .wm-halo, .wm-title-in, .wm-row-in, .wm-row-glow { animation: none; }
  .wm-fleck, .wm-wash { display: none; }
}
`;

/** Screen-wide warm glow from the top, so the moment reads bright, not dimmed. */
export function GoldWash() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), 2200);
    return () => window.clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div
      className="wm-wash fixed inset-0 z-[60] pointer-events-none"
      style={{
        background:
          'radial-gradient(120% 70% at 50% 8%, rgba(246,224,160,.34) 0%, rgba(212,168,67,.16) 35%, rgba(212,168,67,0) 70%)',
        animation: 'wm-wash 2100ms ease-out both',
      }}
    />
  );
}

/** Title block: the crown drops onto the winner's name, glow and flecks. */
export function CrownTitle({ title, iWon }: { title: string; iWon: boolean }) {
  const flecks = useMemo(
    () =>
      Array.from({ length: iWon ? 28 : 14 }, (_, i) => ({
        id: i,
        /* eslint-disable react-hooks/purity */
        left: 30 + Math.random() * 40,
        top: 18 + Math.random() * 30,
        dx: Math.round(-90 + Math.random() * 180),
        dy: Math.round(-30 + Math.random() * 150),
        delay: (CROWN_LANDS_MS + Math.random() * 450) / 1000,
        dur: 1.1 + Math.random() * 0.8,
        /* eslint-enable react-hooks/purity */
      })),
    [iWon],
  );
  return (
    <div className="relative text-center pt-1">
      <style>{KEYFRAMES}</style>
      {/* Stays as a soft glow behind the name after the bloom. */}
      <div
        className="wm-halo absolute left-1/2 top-[34px] w-[260px] h-[200px] -ml-[130px] -mt-[100px] pointer-events-none opacity-55"
        style={{
          background:
            'radial-gradient(closest-side, rgba(226,197,121,.38), rgba(212,168,67,.12) 55%, rgba(212,168,67,0))',
        }}
      />
      <div
        className="wm-crown-drop relative mx-auto w-12 h-12 rounded-full flex items-center justify-center"
        style={{
          background: 'linear-gradient(180deg,#f0dda0 0%,#c9a141 45%,#9c7a26 100%)',
          border: '1px solid #e2c579',
          boxShadow: '0 4px 14px rgba(0,0,0,.45), 0 0 24px rgba(226,197,121,.45)',
        }}
        aria-hidden="true"
      >
        <span className="text-[#2a2010] text-[28px] leading-none -mt-0.5">♛</span>
      </div>
      <div className="relative eyebrow mt-3">Game over</div>
      <div className="wm-title-in relative font-display font-semibold text-[30px] leading-none text-cream-bright mt-2.5">
        {title}
      </div>
      <div className="relative ornament mt-3.5">
        <span className="diamond" />
      </div>
      {flecks.map((f) => (
        <span
          key={f.id}
          className="wm-fleck absolute w-[6px] h-[6px] pointer-events-none"
          style={
            {
              left: `${f.left}%`,
              top: `${f.top}%`,
              background: 'linear-gradient(135deg,#f6e7b4,#d4a843)',
              boxShadow: '0 0 6px rgba(226,197,121,.6)',
              '--dx': `${f.dx}px`,
              '--dy': `${f.dy}px`,
              '--delay': `${f.delay}s`,
              '--dur': `${f.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** A score that counts up from 0 after `delay` ms (ease-out over 650 ms). */
export function CountUp({ value, delay, format }: { value: number; delay: number; format: (n: number) => string }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t = window.setTimeout(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 650);
        setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); };
  }, [value, delay, reduced]);
  return <>{format(shown)}</>;
}
