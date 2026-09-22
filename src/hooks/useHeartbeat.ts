/**
 * Presence used to be a heartbeat written to Firestore every 10 s. The game
 * server now sees the socket itself, so there is nothing to beat; kept as
 * a no-op so the Room route needs no change.
 */
export function useHeartbeat(_code: string, _name: string | null): void {}
