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
