import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { useRoom } from '../hooks/useRoom';
import { IdentityPrompt } from '../components/IdentityPrompt';
import { Lobby } from '../components/Lobby';
import { GameView } from '../components/GameView';
import { isValidRoomCode } from '../lib/codes';
import { joinRoom, RoomError, MAX_PLAYERS } from '../lib/rooms';

export function Room() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = (rawCode ?? '').toUpperCase();
  const navigate = useNavigate();
  const { session, clearSession } = useSession();
  const { uid } = useAnonymousAuth();
  const { room, players, loading, notFound } = useRoom(code);

  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const myName = session?.playerName ?? null;
  const inRoom = !!room && !!myName && room.playerOrder.includes(myName);

  // Auto-join once we have a session, an auth UID, and a real room.
  useEffect(() => {
    if (!session || !uid || !room || joining) return;
    if (room.playerOrder.includes(session.playerName)) return;
    if (room.status !== 'lobby') {
      setJoinError('That game is already in progress.');
      return;
    }
    if (room.playerOrder.length >= MAX_PLAYERS) {
      setJoinError('That room is full.');
      return;
    }
    setJoining(true);
    setJoinError(null);
    joinRoom(code, session.playerName, uid)
      .catch((err: unknown) => {
        if (err instanceof RoomError) {
          if (err.code === 'roomNotFound') setJoinError('Room not found.');
          else if (err.code === 'roomFull') setJoinError('Room is full.');
          else if (err.code === 'gameStarted') setJoinError('Game already started.');
          else setJoinError('Could not join room.');
        } else {
          setJoinError(err instanceof Error ? err.message : 'Could not join room.');
        }
      })
      .finally(() => setJoining(false));
  }, [session, uid, room, code, joining]);

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
    <div className="min-h-svh flex flex-col items-center px-6 pt-8 pb-10">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="self-start text-sm text-navy-200 mb-4"
      >
        ← Back
      </button>

      {!session ? (
        <IdentityPrompt
          title={`Join room ${code}`}
          subtitle="Enter your name and PIN to join. Same name as before? Use the same PIN."
        />
      ) : loading ? (
        <p className="text-navy-200 text-sm mt-10">Loading room…</p>
      ) : notFound ? (
        <div className="card-gold p-5 max-w-sm w-full text-center space-y-3">
          <p className="text-rose-300">Room {code} doesn’t exist.</p>
          <Link to="/" className="text-gold-200 underline">
            Back to home
          </Link>
        </div>
      ) : joinError ? (
        <div className="card-gold p-5 max-w-sm w-full text-center space-y-3">
          <p className="text-rose-300">{joinError}</p>
          <Link to="/" className="text-gold-200 underline">
            Back to home
          </Link>
        </div>
      ) : !inRoom ? (
        <p className="text-navy-200 text-sm mt-10">Joining…</p>
      ) : (
        <>
          <div className="w-full max-w-md card-gold-subtle px-4 py-2 mb-4 flex items-center justify-between">
            <span className="text-sm text-navy-100">
              Playing as{' '}
              <strong className="text-gold-100">{session.playerName}</strong>
            </span>
            <button
              type="button"
              onClick={() => clearSession()}
              className="text-xs text-navy-200 underline underline-offset-2 hover:text-gold-200"
            >
              switch
            </button>
          </div>
          {room!.status === 'lobby' ? (
            <Lobby room={room!} players={players} myName={session.playerName} />
          ) : (
            <GameView room={room!} myName={session.playerName} />
          )}
        </>
      )}
    </div>
  );
}
