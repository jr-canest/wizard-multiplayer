import { useEffect } from 'react';

type WakeLockSentinel = {
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
};

/**
 * Keep the screen awake while the component is mounted and the tab is
 * visible. Re-acquires on visibilitychange because the browser releases the
 * sentinel whenever the tab is backgrounded. Silently no-ops where the API
 * isn't supported (older Safari, etc.).
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await nav.wakeLock!.request('screen');
        if (cancelled) {
          next.release().catch(() => {});
          return;
        }
        sentinel = next;
      } catch {
        // user gesture / permissions issue — skip
      }
    };

    const onVis = () => {
      if (document.visibilityState === 'visible' && !sentinel) {
        acquire();
      }
    };

    acquire();
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
