import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../lib/rooms';
import { useSession } from '../hooks/useSession';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';

export function CreateRoomPanel() {
  const navigate = useNavigate();
  const { session } = useSession();
  const { uid } = useAnonymousAuth();
  const [canadianRule, setCanadianRule] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!session || !uid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = await createRoom(session.playerName, uid, canadianRule);
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
