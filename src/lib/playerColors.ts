/**
 * Stable per-player color assignment derived from the player's index in
 * `playerOrder`. We hand back full Tailwind class strings (rather than building
 * them dynamically) so v4's content scanner picks them up.
 */

export type PlayerColor = {
  key: string;
  /** Solid border color for opponent tile / accents. */
  border: string;
  /** Bright ring around active items (cards in trick area, active opponent). */
  ring: string;
  /** Soft text color for the player's name. */
  text: string;
  /** Glow shadow when the player is currently acting. */
  glow: string;
  /** Dot background for inline color chips. */
  dot: string;
};

const PALETTE: PlayerColor[] = [
  {
    key: 'rose',
    border: 'border-rose-500',
    ring: 'ring-rose-400',
    text: 'text-rose-200',
    glow: 'shadow-[0_0_14px_rgba(251,113,133,0.55)]',
    dot: 'bg-rose-400',
  },
  {
    key: 'amber',
    border: 'border-amber-500',
    ring: 'ring-amber-400',
    text: 'text-amber-200',
    glow: 'shadow-[0_0_14px_rgba(251,191,36,0.55)]',
    dot: 'bg-amber-400',
  },
  {
    key: 'emerald',
    border: 'border-emerald-500',
    ring: 'ring-emerald-400',
    text: 'text-emerald-200',
    glow: 'shadow-[0_0_14px_rgba(52,211,153,0.55)]',
    dot: 'bg-emerald-400',
  },
  {
    key: 'sky',
    border: 'border-sky-500',
    ring: 'ring-sky-400',
    text: 'text-sky-200',
    glow: 'shadow-[0_0_14px_rgba(56,189,248,0.55)]',
    dot: 'bg-sky-400',
  },
  {
    key: 'violet',
    border: 'border-violet-500',
    ring: 'ring-violet-400',
    text: 'text-violet-200',
    glow: 'shadow-[0_0_14px_rgba(167,139,250,0.55)]',
    dot: 'bg-violet-400',
  },
  {
    key: 'fuchsia',
    border: 'border-fuchsia-500',
    ring: 'ring-fuchsia-400',
    text: 'text-fuchsia-200',
    glow: 'shadow-[0_0_14px_rgba(232,121,249,0.55)]',
    dot: 'bg-fuchsia-400',
  },
  {
    key: 'teal',
    border: 'border-teal-500',
    ring: 'ring-teal-400',
    text: 'text-teal-200',
    glow: 'shadow-[0_0_14px_rgba(45,212,191,0.55)]',
    dot: 'bg-teal-400',
  },
  {
    key: 'orange',
    border: 'border-orange-500',
    ring: 'ring-orange-400',
    text: 'text-orange-200',
    glow: 'shadow-[0_0_14px_rgba(251,146,60,0.55)]',
    dot: 'bg-orange-400',
  },
  {
    key: 'lime',
    border: 'border-lime-500',
    ring: 'ring-lime-400',
    text: 'text-lime-200',
    glow: 'shadow-[0_0_14px_rgba(163,230,53,0.55)]',
    dot: 'bg-lime-400',
  },
  {
    key: 'pink',
    border: 'border-pink-500',
    ring: 'ring-pink-400',
    text: 'text-pink-200',
    glow: 'shadow-[0_0_14px_rgba(244,114,182,0.55)]',
    dot: 'bg-pink-400',
  },
];

export function playerColor(name: string, playerOrder: string[]): PlayerColor {
  const idx = playerOrder.indexOf(name);
  if (idx < 0) return PALETTE[0];
  return PALETTE[idx % PALETTE.length];
}
