import { Outlet } from 'react-router-dom';
import { useAnonymousAuth } from './hooks/useAnonymousAuth';

export function App() {
  const { uid, ready, error } = useAnonymousAuth();

  if (error) {
    return (
      <div className="min-h-svh flex items-center justify-center px-6 text-center">
        <div className="card-gold p-6 max-w-sm">
          <p className="text-gold-300 font-bold mb-2">Sign-in failed</p>
          <p className="text-sm text-navy-100">{error}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <div className="text-navy-200 text-sm">Connecting…</div>
      </div>
    );
  }

  return (
    <div className="min-h-svh flex flex-col" data-uid={uid}>
      <Outlet />
    </div>
  );
}
