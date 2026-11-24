/** The stored sign-in (name + seat token), readable without React. */
export const SESSION_STORAGE_KEY = 'wizard-multiplayer.session';

export function readToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

/** When the stored seat token runs out (ms), or null if unreadable. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = atob(token.slice(0, token.lastIndexOf('.')));
    const exp = Number(payload.slice(payload.lastIndexOf('|') + 1));
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** Fired with the new token after a renewal, so SessionProvider keeps up. */
export const TOKEN_RENEWED_EVENT = 'wizard-session-token';

/**
 * Swap the stored seat token for a fresh one (the server accepts one past
 * its end date for a good while, 2026-11-23). Stores it and tells the
 * SessionProvider. `null` = the server said no (sign in again) or could
 * not be reached.
 */
export async function renewStoredToken(serverUrl: string): Promise<string | null> {
  const token = readToken();
  if (!token) return null;
  try {
    const res = await fetch(`${serverUrl}/session/renew`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    const fresh = ((await res.json()) as { token?: string }).token;
    if (typeof fresh !== 'string') return null;
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...JSON.parse(raw), token: fresh }));
    window.dispatchEvent(new CustomEvent(TOKEN_RENEWED_EVENT, { detail: fresh }));
    return fresh;
  } catch {
    return null;
  }
}
