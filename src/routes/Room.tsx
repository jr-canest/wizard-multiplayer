import { useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { useRoom } from '../hooks/useRoom';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { setActiveRoomCode } from '../hooks/useActiveRoom';
import { IdentityPrompt } from '../components/IdentityPrompt';
import { Lobby } from '../components/Lobby';
import { GameView } from '../components/GameView';
import { isValidRoomCode } from '../lib/codes';

export function Room() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = (rawCode ?? '').toUpperCase();
  const navigate = useNavigate();
  const { session, clearSession } = useSession();
  useAnonymousAuth();
  const { room, players, loading, notFound, joinError: joinCode, link } = useRoom(code);

  const myName = session?.playerName ?? null;
  const inRoom = !!room && !!myName && room.playerOrder.includes(myName);

  // Joining happens when the socket connects; the server says why not.
  const joinError = joinCode
    ? {
        gameStarted: 'That game is already in progress.',
        roomFull: 'That room is full.',
        nameTaken: 'A computer player in this room already has that name. Pick another name to join.',
        unauthorized: 'Your sign-in has expired. Tap switch and sign in again.',
      }[joinCode] ?? 'Could not join room.'
    : null;

  useHeartbeat(code, inRoom ? myName : null);

  // Expose the live room snapshot for the network test rig (scripts/netlab),
  // which drives real browsers through real games and needs to know the
  // instant a change lands without scraping the DOM. Not dev-gated: the rig
  // runs the production bundle so page loads look like a real phone's, and
  // the snapshot holds nothing a signed-in client cannot already read.
  useEffect(() => {
    (window as unknown as { __wizardRoom?: unknown }).__wizardRoom = room;
  }, [room]);

  // Persist the active room code so Home can offer a "Rejoin" prompt after
  // a tab close. Clear it when we definitively can't get back in: room is
  // gone, locked out, finished, or we got kicked from playerOrder.
  useEffect(() => {
    if (inRoom && room && room.status !== 'finished') {
      setActiveRoomCode(code);
    }
  }, [inRoom, room, code]);

  useEffect(() => {
    if (notFound || (room && room.status === 'finished')) {
      setActiveRoomCode(null);
    }
  }, [notFound, room]);

  useEffect(() => {
    if (joinError) setActiveRoomCode(null);
  }, [joinError]);

  // A stale token means the socket can never seat us: back to sign-in.
  useEffect(() => {
    if (joinCode === 'unauthorized') clearSession();
  }, [joinCode, clearSession]);

  useEffect(() => {
    // Mid-game disappearance from playerOrder = we got kicked. Clear so
    // Home doesn't keep offering to rejoin a room that's locked out.
    if (room && session && !inRoom && room.status !== 'lobby') {
      setActiveRoomCode(null);
    }
  }, [room, session, inRoom]);

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

  const inGame = !!room && room.status !== 'lobby';

  return (
    <div className="min-h-svh flex flex-col items-center px-4 pt-3 pb-3">
      {!inGame && (
        <button
          type="button"
          onClick={() => navigate('/')}
          className="self-start text-sm text-navy-200 mb-3"
        >
          ← Back
        </button>
      )}

      {/* The link to the game server, only when it is not fine. A phone
          that slept or lost Wi-Fi shows this instead of a frozen table. */}
      {inRoom && link !== 'online' && (
        <div
          role="status"
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[600] rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] bg-amber-500/90 text-navy-950 shadow-lg animate-pulse"
        >
          {link === 'closed' ? 'Disconnected' : 'Reconnecting…'}
        </div>
      )}

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
          {!inGame && (
            <div className="w-full max-w-md card-gold-subtle px-4 py-2 mb-3 flex items-center justify-between">
              <span className="text-sm text-navy-100">
                Playing as{' '}
                <strong className="font-display font-semibold text-[16px] text-cream-bright">{session.playerName}</strong>
              </span>
              <button
                type="button"
                onClick={() => clearSession()}
                className="text-xs text-navy-200 underline underline-offset-2 hover:text-gold-200"
              >
                switch
              </button>
            </div>
          )}
          {room!.status === 'lobby' ? (
            <Lobby room={room!} players={players} myName={session.playerName} />
          ) : (
            <GameView
              room={room!}
              players={players}
              myName={session.playerName}
            />
          )}
          {inGame && (
            <div className="mt-3 flex items-center gap-3 text-[11px] text-navy-400">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="hover:text-navy-200"
              >
                ← back
              </button>
              <span className="text-navy-500">·</span>
              <span>
                {session.playerName}
                <button
                  type="button"
                  onClick={() => clearSession()}
                  className="ml-1.5 underline underline-offset-2 hover:text-navy-200"
                >
                  switch
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
