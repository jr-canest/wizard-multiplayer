import { useState } from 'react';
import { chooseTrumpSuit } from '../lib/gameFlow';
import type { Suit } from '../lib/types';

// U+FE0E after each glyph asks for the text glyph, not the emoji: at this
// size Chrome and iOS otherwise pick the emoji font (pink heart, blue gem).
const SUITS: Array<{ s: Suit; glyph: string; label: string; color: string }> = [
  { s: 'H', glyph: '♥\uFE0E', label: 'Hearts', color: 'text-rose-300' },
  { s: 'D', glyph: '♦\uFE0E', label: 'Diamonds', color: 'text-sky-300' },
  { s: 'C', glyph: '♣\uFE0E', label: 'Clubs', color: 'text-emerald-300' },
  { s: 'S', glyph: '♠\uFE0E', label: 'Spades', color: 'text-navy-100' },
];

export function TrumpChooser({
  code,
  callerName,
}: {
  code: string;
  callerName: string;
}) {
  const [submitting, setSubmitting] = useState<Suit | null>(null);

  async function pick(s: Suit) {
    setSubmitting(s);
    try {
      await chooseTrumpSuit(code, callerName, s);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    // Sits in the middle of the trick area (Table's centerBanner slot):
    // it must never push the table or the hand down.
    <div className="card-gold bg-navy-900/95 backdrop-blur px-3 py-2.5 w-[222px] pointer-events-auto animate-bid-modal-in shadow-2xl">
      <div className="text-center leading-tight mb-2">
        <div className="text-[9px] uppercase tracking-[0.24em] font-bold text-gold-300">Wizard flipped</div>
        <div className="font-display font-semibold text-[16px] text-cream-bright">Pick the trump suit</div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {SUITS.map((opt) => (
          <button
            key={opt.s}
            type="button"
            disabled={submitting !== null}
            onClick={() => pick(opt.s)}
            className="card-gold-subtle py-1.5 flex items-center justify-center gap-1.5 hover:border-gold-300 active:border-gold-300 disabled:opacity-50"
          >
            <span className={`text-[22px] leading-none ${opt.color}`}>{opt.glyph}</span>
            <span className="text-[12px] text-navy-50">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
