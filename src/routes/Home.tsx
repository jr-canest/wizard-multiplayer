import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useActiveRoom } from '../hooks/useActiveRoom';
import { IdentityPrompt } from '../components/IdentityPrompt';
import { formatVersion } from '../lib/appVersion';
import { CreateRoomPanel } from '../components/CreateRoomPanel';

export function Home() {
  const navigate = useNavigate();
  const { session, clearSession } = useSession();
  const { code: activeRoom, setCode: setActiveRoom } = useActiveRoom();
  const [code, setCode] = useState('');

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 4) return;
    navigate(`/room/${trimmed}`);
  }

  return (
    <div className="min-h-screen-z flex flex-col items-center px-6 pt-10 pb-10">
      <div className="flex items-center gap-2.5 mb-2">
        <span className="diamond" />
        <img
          src={`${import.meta.env.BASE_URL}wizard-logo.svg`}
          alt="Wizard"
          className="h-12"
        />
        <span className="diamond" />
      </div>
      <p className="eyebrow mb-8">Multiplayer</p>

      {!session ? (
        <IdentityPrompt />
      ) : (
        <div className="w-full max-w-sm space-y-3">
          <div className="card-gold-subtle px-4 h-11 flex items-center justify-between">
            <span className="text-sm text-navy-200">
              Playing as{' '}
              <strong className="font-display font-semibold text-[16px] text-cream-bright">{session.playerName}</strong>
            </span>
            <button
              type="button"
              onClick={clearSession}
              className="text-xs text-navy-300 underline underline-offset-2 hover:text-gold-text"
            >
              switch
            </button>
          </div>

          {activeRoom && (
            <div className="card-gold card-gold-active p-4 space-y-2.5">
              <div className="section-label">In progress</div>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-[30px] leading-none tracking-[0.3em] text-gold-text">
                  {activeRoom}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveRoom(null)}
                  className="text-xs text-navy-300 underline underline-offset-2 hover:text-rose-300"
                >
                  forget
                </button>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/room/${activeRoom}`)}
                className="btn-gold w-full h-12 text-base"
              >
                Rejoin room
              </button>
            </div>
          )}

          <CreateRoomPanel />

          <form onSubmit={handleJoin} className="card-gold p-4 space-y-3">
            <label className="section-label block" htmlFor="code">
              Join with 4-char code
            </label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-3 py-2.5 text-center font-display font-semibold text-2xl tracking-[0.4em] text-cream placeholder-navy-300 focus:border-gold-300 focus:outline-none"
              placeholder="A B C D"
            />
            <button
              type="submit"
              className="btn-gold w-full h-12 text-base"
              disabled={code.trim().length !== 4}
            >
              Join
            </button>
          </form>

          <button
            type="button"
            onClick={() => navigate('/me')}
            className="btn-secondary w-full h-11 text-sm"
          >
            📊 My stats
          </button>

          <button
            type="button"
            onClick={() => navigate('/history')}
            className="btn-secondary w-full h-11 text-sm"
          >
            📜 Game history
          </button>

          <a
            href="https://wizard-scorekeeper.web.app/"
            className="btn-secondary flex items-center justify-center w-full h-11 text-sm no-underline"
          >
            ↗ Open Score Keeper
          </a>

          {/* Build stamp (date · commit) so it's obvious which build a phone is on */}
          <p className="text-center text-navy-200/25 text-[10px] tabular-nums pt-1">
            {formatVersion()}
          </p>
        </div>
      )}
    </div>
  );
}
