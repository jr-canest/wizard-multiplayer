import { useEffect, useState } from 'react';
import { APP_VERSION } from '../lib/appVersion';

// How often to re-check while the app stays open. Checks also fire on
// load and whenever the tab/PWA comes back to the foreground, which is
// the common case on a phone left on the table between rounds.
const CHECK_EVERY_MS = 5 * 60 * 1000;

async function fetchLiveVersion(): Promise<string | null> {
  // no-store bypasses the browser cache; Firebase Hosting also serves
  // version.json with no-cache (firebase.json) so the CDN never lags.
  const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('json')) return null;
  const data: unknown = await res.json();
  const version = (data as { version?: unknown })?.version;
  return typeof version === 'string' ? version : null;
}

// Returns the live build's version once it differs from the one this
// page was built with, otherwise null. Never fires in dev (no
// version.json there) and swallows network errors — being offline mid-game
// must not surface anything.
export function useUpdateCheck(): string | null {
  const [liveVersion, setLiveVersion] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;

    async function check() {
      try {
        const live = await fetchLiveVersion();
        if (!cancelled && live && live !== APP_VERSION) setLiveVersion(live);
      } catch {
        // offline or mid-deploy — try again on the next tick
      }
    }

    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return liveVersion;
}
