import { useEffect } from 'react';

// Phone baseline. iPhone-class viewports stay at 1.0x. Anything bigger
// (iPad, desktop) scales up so the same layout fills more of the window.
const BASE_W = 380;
const BASE_H = 720;
const MIN_SCALE = 1;
// Cap the scale so very large monitors don't render the UI absurdly large.
const MAX_SCALE = 2.4;

function computeScale(): number {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Take the smaller axis ratio so the UI never overflows the viewport.
  const s = Math.min(w / BASE_W, h / BASE_H);
  return Math.max(MIN_SCALE, Math.min(s, MAX_SCALE));
}

/**
 * Read the currently-applied UI zoom. Used by code that anchors fixed
 * elements (modals, popovers, drag ghosts, deal animation) to other
 * elements via getBoundingClientRect / pointer events. Those report
 * post-zoom (visual) viewport pixels but `position: fixed` inside the
 * zoomed body interprets values in pre-zoom CSS pixels — divide by the
 * zoom to convert.
 */
export function getUIZoom(): number {
  if (typeof document === 'undefined') return 1;
  const raw = getComputedStyle(document.body)
    .getPropertyValue('--ui-zoom')
    .trim();
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Drive a CSS variable (`--ui-zoom`) on the document body from the viewport
 * size. The base layout is sized for a phone — this scales it up uniformly
 * on iPad/desktop so the UI fills the available space instead of sitting
 * inside a narrow column. Mounts once at app root.
 */
export function useUIScale(): void {
  useEffect(() => {
    function update() {
      const s = computeScale();
      document.body.style.setProperty('--ui-zoom', String(s));
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.body.style.removeProperty('--ui-zoom');
    };
  }, []);
}
