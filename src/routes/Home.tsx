import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 4) return;
    navigate(`/room/${trimmed}`);
  }

  return (
    <div className="min-h-svh flex flex-col items-center px-6 pt-16 pb-10">
      <h1 className="text-5xl font-black tracking-wide text-gold-200 mb-2">
        WIZARD
      </h1>
      <p className="text-navy-100 text-sm mb-10">multiplayer</p>

      <div className="w-full max-w-sm space-y-3">
        <button
          type="button"
          className="btn-gold w-full rounded-xl py-4 text-lg"
          onClick={() => alert('Room creation coming in step 3')}
        >
          Create room
        </button>

        <form onSubmit={handleJoin} className="card-gold p-4 space-y-3">
          <label className="block text-sm text-navy-100" htmlFor="code">
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
            className="w-full rounded-lg bg-navy-800 border border-navy-500 px-3 py-3 text-center text-2xl font-mono tracking-[0.4em] text-gold-100"
            placeholder="A B C D"
          />
          <button
            type="submit"
            className="btn-gold w-full rounded-lg py-3"
            disabled={code.trim().length !== 4}
          >
            Join
          </button>
        </form>
      </div>
    </div>
  );
}
