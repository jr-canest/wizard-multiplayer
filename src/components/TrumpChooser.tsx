import { useState } from 'react';
import { chooseTrumpSuit } from '../lib/gameFlow';
import type { Suit } from '../lib/types';

const SUITS: Array<{ s: Suit; glyph: string; label: string; color: string }> = [
  { s: 'H', glyph: '♥', label: 'Hearts', color: 'text-rose-300' },
  { s: 'D', glyph: '♦', label: 'Diamonds', color: 'text-sky-300' },
  { s: 'C', glyph: '♣', label: 'Clubs', color: 'text-emerald-300' },
  { s: 'S', glyph: '♠', label: 'Spades', color: 'text-navy-100' },
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
    <div className="card-gold p-4 max-w-md w-full space-y-3">
      <p className="text-gold-200 font-semibold">
        You flipped a Wizard — pick the trump suit.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {SUITS.map((opt) => (
          <button
            key={opt.s}
            type="button"
            disabled={submitting !== null}
            onClick={() => pick(opt.s)}
            className="card-gold-subtle py-3 flex items-center justify-center gap-2 hover:border-gold-300 disabled:opacity-50"
          >
            <span className={`text-2xl ${opt.color}`}>{opt.glyph}</span>
            <span className="text-navy-50">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
