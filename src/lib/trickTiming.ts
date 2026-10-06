// How long a finished trick stays on the table with its "X won" banner
// (Jorge, 2026-10-06: 1.5 s, was 2 s mid-round and 3 s for a round's last
// trick). The banner's CSS animation (.animate-trick-banner) runs the same
// length, and the game server's computer lead delay
// (BOT_NEW_TRICK_DELAY_MS in server/src/index.ts) waits this out plus the
// collect animation.
export const TRICK_HOLD_MS = 1500;
// The round's last trick: then the round scoreboard takes over.
export const LAST_TRICK_HOLD_MS = 1500;
