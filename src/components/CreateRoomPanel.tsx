import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../lib/rooms';
import { useSession } from '../hooks/useSession';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { setActiveRoomCode } from '../hooks/useActiveRoom';

export function CreateRoomPanel() {
  const navigate = useNavigate();
  const { session } = useSession();
  const { uid } = useAnonymousAuth();
  const [canadianRule, setCanadianRule] = useState(true);
  const [withBots, setWithBots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const devModeEnabled =
    import.meta.env.DEV || session?.playerName.trim().toLowerCase() === 'test';

  async function handleCreate() {
    if (!session || !uid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = await createRoom(session.playerName, uid, canadianRule, {
        withBots: devModeEnabled && withBots,
      });
      setActiveRoomCode(code);
      navigate(`/room/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room.');
      setSubmitting(false);
    }
  }

  return (
    <div className="card-gold p-4 space-y-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm text-gold-100">Canadian rules</span>
          <span className="block text-xs text-navy-200">
            Dealer can’t bid the value that balances the round.
          </span>
        </span>
        <input
          type="checkbox"
          checked={canadianRule}
          onChange={(e) => setCanadianRule(e.target.checked)}
          className="h-5 w-5 accent-gold-300"
        />
      </label>

      {devModeEnabled && (
        <label className="flex items-center justify-between gap-3 rounded-md border border-dashed border-gold-700/60 px-3 py-2">
          <span>
            <span className="block text-sm text-gold-100">Dev: add 3 bots</span>
            <span className="block text-xs text-navy-200">
              Solo-test with 3 bot opponents. Visible in dev only.
            </span>
          </span>
          <input
            type="checkbox"
            checked={withBots}
            onChange={(e) => setWithBots(e.target.checked)}
            className="h-5 w-5 accent-gold-300"
          />
        </label>
      )}

      {error && (
        <p className="text-sm text-rose-300 bg-rose-900/30 border border-rose-700/50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={submitting || !session || !uid}
        className="btn-gold w-full rounded-xl py-4 text-lg"
      >
        {submitting ? 'Creating…' : 'Create room'}
      </button>
    </div>
  );
}
