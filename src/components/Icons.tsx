// Small line icons drawn in SVG (2026-10-29). Text glyphs (☰ ✕ ← ↗ and the
// emoji ones) sit off-centre in round buttons and render as colour emoji on
// iPhones, so every icon in the app comes from here. All take currentColor
// and are sized by `size` (px).
type P = { size?: number; className?: string };

const base = (size: number, className = '') => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
});

export const MenuIcon = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}><path d="M3 4.5h10M3 8h10M3 11.5h10" /></svg>
);
export const CloseIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const BackIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}><path d="M9.5 3.5L5 8l4.5 4.5" /></svg>
);
export const ChevronRightIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}><path d="M6 4l4 4-4 4" /></svg>
);
export const ChevronDownIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}><path d="M4 6l4 4 4-4" /></svg>
);
export const ExternalIcon = ({ size = 13, className }: P) => (
  <svg {...base(size, className)}><path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5" /></svg>
);
export const StatsIcon = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}><path d="M3 13V8.5M8 13V3.5M13 13V6.5M2 13.5h12" /></svg>
);
export const HistoryIcon = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}><path d="M2.8 8a5.2 5.2 0 1 0 1.5-3.7M2.5 2.5v2.4h2.4M8 5.2V8l2 1.4" /></svg>
);
export const CheckIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)} strokeWidth={2}><path d="M3.5 8.5l3 3 6-7" /></svg>
);
/** Hollow ring: "not yet" (e.g. hasn't ticked Next round). */
export const RingIcon = ({ size = 10, className }: P) => (
  <svg {...base(size, className)} strokeWidth={1.8}><circle cx="8" cy="8" r="4.5" /></svg>
);

// Card suits, filled, sized in em so they sit in a line of text. Drawn
// because the text glyphs differ wildly by platform: iPhones draw ♠ ♥ ♦ ♣
// at about half the size Chrome does (seen in the simulator, 2026-11-25).
const SUIT_PATH = {
  H: 'M8 14.2S2.3 10.5 2.3 6.5A3.2 3.2 0 0 1 8 4.6a3.2 3.2 0 0 1 5.7 1.9c0 4-5.7 7.7-5.7 7.7z',
  D: 'M8 1.4l5 6.6-5 6.6L3 8z',
  S: 'M8 1.4s5.6 4.1 5.6 7.7a2.9 2.9 0 0 1-4.9 2.1c.2 1.2.7 2.2 1.6 3.3H5.7c.9-1.1 1.4-2.1 1.6-3.3a2.9 2.9 0 0 1-4.9-2.1C2.4 5.5 8 1.4 8 1.4z',
  C: 'M8 1.6a2.9 2.9 0 0 1 2.5 4.4 2.9 2.9 0 1 1-1.8 5.1c.2 1.2.7 2.2 1.6 3.4H5.7c.9-1.2 1.4-2.2 1.6-3.4A2.9 2.9 0 1 1 5.5 6 2.9 2.9 0 0 1 8 1.6z',
} as const;
export const SuitIcon = ({ suit, className = '' }: { suit: 'H' | 'D' | 'C' | 'S'; className?: string }) => (
  <svg viewBox="0 0 16 16" width="0.95em" height="0.95em" fill="currentColor" aria-hidden="true" className={`inline-block align-[-0.12em] ${className}`}>
    <path d={SUIT_PATH[suit]} />
  </svg>
);
