// Build stamp baked in by vite.config.ts, e.g. "2026.09.09-95bb69e"
// (build date + short commit). "dev" under `npm run dev`.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';

// "2026.09.09-95bb69e" → "v2026.09.09 · 95bb69e"
export function formatVersion(version: string = APP_VERSION): string {
  const [date, sha] = version.split('-');
  return sha ? `v${date} · ${sha}` : `v${version}`;
}
