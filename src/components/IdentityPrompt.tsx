import { useState } from 'react';
import { fetchSeatToken } from '../lib/rooms';
import {
  claimOrAuthPlayer,
  isValidPin,
  isValidPlayerName,
} from '../lib/players';
import { useSession } from '../hooks/useSession';

type Props = {
  title?: string;
  subtitle?: string;
  onAuthed?: () => void;
};

export function IdentityPrompt({ title, subtitle, onAuthed }: Props) {
  const { setSession } = useSession();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = isValidPlayerName(name);
  const pinOk = isValidPin(pin);
  const canSubmit = nameOk && pinOk && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await claimOrAuthPlayer(name, pin);
      if (!result.ok) {
        setError(
          result.reason === 'wrongPin'
            ? 'That PIN doesn’t match the name on file.'
            : 'Sign-in failed. Try again.',
        );
        return;
      }
      // The game server verifies the same PIN and hands back a seat token
      // the socket presents on every connection.
      const token = await fetchSeatToken(result.player.name, pin);
      setSession({
        playerId: result.player.id,
        playerName: result.player.name,
        token,
      });
      onAuthed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card-gold p-5 w-full max-w-sm space-y-4">
      <div>
        <h2 className="font-display font-semibold text-[24px] leading-none text-cream-bright mb-2">
          {title ?? 'Who’s playing?'}
        </h2>
        <p className="text-navy-200 text-sm">
          {subtitle ?? 'Pick a name and a 4-digit PIN. The PIN keeps your name yours across devices.'}
        </p>
      </div>

      <label className="block">
        <span className="section-label block mb-1.5">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoCapitalize="words"
          spellCheck={false}
          className="w-full h-11 rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-3 text-lg text-cream placeholder-navy-300 focus:border-gold-300 focus:outline-none"
          placeholder="Jorge"
        />
      </label>

      <label className="block">
        <span className="section-label block mb-1.5">PIN (4 digits)</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          className="w-full rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-3 py-2 font-display font-semibold text-2xl tracking-[0.6em] text-center text-cream placeholder-navy-300 focus:border-gold-300 focus:outline-none"
          placeholder="• • • •"
        />
      </label>

      {error && (
        <p className="text-sm text-rose-300 bg-rose-900/30 border border-rose-700/50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn-gold w-full h-12 text-base"
        disabled={!canSubmit}
      >
        {submitting ? 'Checking…' : 'Continue'}
      </button>
    </form>
  );
}
