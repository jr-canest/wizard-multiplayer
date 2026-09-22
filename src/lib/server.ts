// Where the game server lives. Overridable per build (VITE_GAME_SERVER) so a
// local `wrangler dev` (http://localhost:8788) can be used from `npm run dev`;
// the default is the deployed Worker so laptop builds match CI builds.
export const GAME_SERVER_URL: string =
  (import.meta.env.VITE_GAME_SERVER as string | undefined) || 'https://wizard-game.jrcanest.workers.dev';

export function gameWsUrl(code: string, token: string): string {
  const u = new URL(GAME_SERVER_URL);
  u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
  u.pathname = `/ws/${code}`;
  u.searchParams.set('token', token);
  return u.toString();
}
