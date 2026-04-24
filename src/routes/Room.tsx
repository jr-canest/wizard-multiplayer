import { Link, useParams } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { IdentityPrompt } from '../components/IdentityPrompt';
import { isValidRoomCode } from '../lib/codes';

export function Room() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = (rawCode ?? '').toUpperCase();
  const { session, clearSession } = useSession();

  if (!isValidRoomCode(code)) {
    return (
      <div className="min-h-svh flex flex-col items-center px-6 pt-16">
        <p className="text-rose-300 mb-4">That doesn’t look like a valid room code.</p>
        <Link to="/" className="text-gold-200 underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-svh flex flex-col items-center px-6 pt-10 pb-10">
      <Link to="/" className="self-start text-sm text-navy-200 mb-6">
        ← Back
      </Link>
      <h1 className="text-3xl font-black tracking-[0.4em] text-gold-200 mb-1">
        {code}
      </h1>
      <p className="text-navy-100 text-sm mb-8">room</p>

      {!session ? (
        <IdentityPrompt
          title={`Join room ${code}`}
          subtitle="Enter your name and PIN to join. Same name as last time? Use the same PIN."
        />
      ) : (
        <div className="w-full max-w-sm space-y-4">
          <div className="card-gold-subtle px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-navy-100">
              Playing as{' '}
              <strong className="text-gold-100">{session.playerName}</strong>
            </span>
            <button
              type="button"
              onClick={clearSession}
              className="text-xs text-navy-200 underline underline-offset-2 hover:text-gold-200"
            >
              switch
            </button>
          </div>
          <p className="text-navy-100 text-sm">
            Lobby coming in step 3 (room create/join + player list).
          </p>
        </div>
      )}
    </div>
  );
}
