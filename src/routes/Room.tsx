import { Link, useParams } from 'react-router-dom';

export function Room() {
  const { code } = useParams<{ code: string }>();

  return (
    <div className="min-h-svh flex flex-col items-center px-6 pt-10 pb-10">
      <Link to="/" className="self-start text-sm text-navy-200 mb-6">
        ← Back
      </Link>
      <h1 className="text-3xl font-black tracking-[0.4em] text-gold-200 mb-2">
        {code}
      </h1>
      <p className="text-navy-100 text-sm">
        Lobby coming in step 3 (player identity + room create/join).
      </p>
    </div>
  );
}
