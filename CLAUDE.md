# Wizard Multiplayer — current state (2026-08)

- **Live:** https://wizard-multiplayer.web.app (Firebase Hosting, target `multiplayer`, project `wizard-scores-2521c`, shared with wizard-scorekeeper). The old GitHub Pages URL is a stale mirror — do not use.
- **Game server (since 2026-09-21): `server/`, a Cloudflare Worker + Durable Object on Jorge's personal account (`wizard-game`, https://wizard-game.jrcanest.workers.dev).** One `RoomDO` per room code owns the whole game; phones hold a WebSocket to it. The rules are `src/game/engine.ts` (pure, shared by server and client, no Firestore); the server persists the engine state in DO storage, runs the computer players and the vote clocks on alarms, and sends every socket a full snapshot on every change (the room only carries the current round; the finished snapshot carries the full log) plus that socket's own hand. Client side: `src/lib/socket.ts` (`RoomConnection`: ping every 3 s, dead after 7 s, back-off to 4 s, snapshot on every reconnect, actions wait for an ack), `useRoom` / `useMyHand` / `useChat` read it, and `src/lib/gameFlow.ts` / `rooms.ts` / `presence.ts` / `chat.ts` keep their old function names as message senders so components did not change. **Firestore now holds only players (names, PINs, stats), games (History) and reactionStats**; the `rooms` collection is dead. Identity: after the app's own PIN check, `POST /session` on the server re-verifies the PIN (same salted SHA-256, read from `players` via REST) and mints a 60-day HMAC seat token stored in the session; `POST /rooms` (bearer token) creates a room; `GET /ws/CODE?token=` is the socket. Typecheck: `cd server && npm run typecheck` (wrangler bundles with esbuild and checks nothing on its own). Deploy: `cd server && npx wrangler deploy` (account id 83367d4d1ff1b1e8370c700d6aede5bf; secret `SESSION_SECRET` already set; rotating it signs everyone out). `VITE_GAME_SERVER` overrides the server URL for a local `wrangler dev --port 8788`. The history write still happens on a phone (`saveMultiplayerGame(room)`), but the server hands out the exactly-once claim (`claimHistory` / `markHistorySaved`), same for the AI recap claim. Why: measured on 2026-09-20 (`scripts/netlab/report-2026-09-20.md`), Firestore needed two round trips per play and its reconnect after a dropout was 3 to 23 s and untunable; this is one round trip and a reconnect the app controls, which is what made the game unplayable on plane Wi-Fi and made phones need a refresh after sleeping.
- **Deploy:** push to `main` = CI deploy (GitHub Actions → Firebase hosting + firestore rules). Manual fallback: `npm run build && firebase deploy --only hosting:multiplayer --project wizard-scores-2521c`.
- **Run locally:** `npm install && npm run dev` (port 5181). Firestore writes to shared history are skipped on localhost.
- **Test link:** `?test` on the home page unlocks the "add 3 bots" panel (pre-checked). Bot games and games with a player named `test` are never written to shared history.
- **Design:** "1b Evolve" kit (2026-08-19), shared with wizard-scorekeeper — spec in the design handoff; kit classes in `src/index.css` (`.btn-gold`, `.card-gold(-active/-subtle)`, `.chip*`, `.felt`, `.eyebrow`, `.ornament`). Kit classes are unlayered CSS and beat Tailwind utilities.
- **Typography rules (2026-08-20, both apps):** serif (`font-display`, Cormorant Garamond) = IDENTITY/NARRATIVE only — screen titles, player names, room codes, AI recap prose; never below 13px. Sans = ALL numerals (always `tabular-nums`, semibold/bold), labels, buttons, chips, status words. Numerals are NEVER serif.
- Keep both apps visually in lockstep — anything added to one index.css kit should land in the other.
- **/history parity rule:** this app's History route and the scorekeeper's HistoryScreen must stay feature-identical (Rating column via `src/lib/ratings.ts` ↔ scorekeeper `src/utils/ratings.js`, podium modal, SWR cache via `src/lib/historyCache.ts`, scoreless toggle, test* filter, online chips, sortable **Best** column re-added 2026-09-02 — `STATS_GRID` template must match the scorekeeper's). Any addition to one gets ported to the other.
- **Chat (history: 2026-09-17 to 2026-09-21 it lived in `rooms/{code}/chat`; since 2026-09-21 the game server keeps it in `EngineState.chat` and pushes `{t:'chat'}` frames, the window rules below still apply).** It used to be a `chat: []` array appended with arrayUnion: every message rewrote the room document (25 to 60 KB mid-game) and re-pushed it to every phone, and the write queued behind gameplay writes on the same doc. Both read as lag. Now each message is its own ~80 byte doc with its own listener (`src/lib/chat.ts`, `src/hooks/useChat.ts`). Chat windows (lobby / each round-end / final) are derived from the room snapshot via `chatWindowKey`, so nothing has to be "cleared"; `chatGen` bumps on Play Again. `room.chat` is still READ for clients on an older build, never written. Firestore rules need the `chat` subcollection match.
- **Turn signal (2026-09-17):** gold = it is YOUR turn, never anything else. `.turn-mine` (bright gold, fast pulse) on the action strip, `.felt-turn-mine` halo on the felt, and the big gold YOUR TURN. An opponent on the clock gets `.turn-theirs` (cool steel, slow pulse) on their tile plus a steel caret, the felt takes a quiet `.felt-turn-theirs` edge, and their name in the strip renders in their own seat colour. Do not reintroduce gold for another player's turn.
- **Reaction usage is counted** in the `reactionStats` collection, one doc per phrase (`src/lib/reactions.ts`, which is also the single source of truth for the picker's phrase list). Readouts: the "Reactions used" card on `/me`, or `node scripts/reaction-stats_V01.mjs`. Localhost and games with a player named `test` are not counted. Keep the CATALOGUE in the script in sync with `REACTIONS`.
- **Commentary overshoot callout:** winning MORE tricks than you bid now gets its own callout (`CommentaryOverlay.tsx`), and it replaces the consecutive-streak line for that trick rather than queueing behind it.
- **Undo is a table-wide vote that PAUSES the game (2026-09-17).** Tapping Undo opens `UndoVoteModal`, a center-screen blocking modal every player sees. While it is open `placeBid` and `playCard` throw `undoVoteOpen` and the bot driver holds, so nobody can act past a vote (which used to overwrite the pending snapshot and silently kill it). A majority of real players approves; enough rejections to put that majority out of reach denies it immediately; a vote nobody answers expires after `UNDO_VOTE_TTL_MS` and any client clears it, so one sleeping phone cannot freeze the table. When the actor is the only real player their own approval carries it and the undo applies on the spot, otherwise the pause would be permanent. The strip above the hand now only carries the actor's "Last bid a mistake?" prompt.
- **Bot driver claims its intent when the action FIRES, not when it is scheduled** (`useBotDriver.ts`). Any room change re-runs the effect and the cleanup kills the pending timer, so claiming up front meant a seat could be skipped forever. The undo pause made that a reliable stall. A failed action clears the claim so the seat retries.
- **Bid picker packs into balanced rows** (`src/lib/bidLayout.ts`): at most 8 per row, columns balanced across the rows needed, wrapping flex so a partial last row centres. Round 15's 16 values are 8 + 8, not the old ragged 6 + 6 + 4. GameView floats the picker over the felt for a single row and only gives it its own place (shrinking the felt) from two rows up, which is now 9 values rather than 7.
- **Round-end pop-up votes (2026-09-18): only "next round is last" and "end game now".** Those two go through one `pendingVote` on the room doc and one `RoundVoteModal` in front of every real player, yes or no; the buttons on `RoundScoreboard` only OPEN a vote. Majority carries it; enough no votes to put a majority out of reach dismiss it; 60s expiry cleared by any client; solo human against computers skips the vote. **Plain "next round" is NOT a pop-up** (Jorge, same day, after a first cut made it one): it stays the quiet ready-tally button with per-player ticks, unanimous mid-game and majority on the final round, via `voteNextRound` + `nextRoundVotes`. The legacy `endEarlyVotes` / `endGameVotes` arrays are still cleared but nothing reads them. `VoteModal.tsx` is the shared box, also used by the undo vote.
- **Inline bid panel hides the action strip.** With two or more rows of bid numbers (9+ values) the panel takes its own place in the layout and the strip under it would be an empty gold box pushing a 15-card hand down, so GameView skips the strip while `inlineBidPanel` is true. The short felt in that mode is 250px (was 210px when the picker could be three rows).
- **Final scoreboard shows the round-by-round table** (won/bid, Δ, running total per player per round), the same `RoundBreakdownTable` the History detail uses, now in `src/components/` and fed from `room.log` via `roundBreakdownFromLog`. Parity with the scorekeeper's end-of-game screen.
- **Score replay: the dot is the tip of the line** (`ScoreLineGraph.tsx`, 2026-09-18, ported from the scorekeeper's BarChartRace fix of 2026-09-10). Each line is a path cut exactly at the current progress (de Casteljau split of the segment under the tip); the dot, label and score all read from that tip point. Do not go back to a stroke-dasharray reveal: that trims by arc length while the dot moves in x, so on steep segments the dot floats off the line.
- **"End game now" logs the final round** (`finishGameNow`, 2026-09-18). It used to fold the just-played round into the final scores without a `roundScore` entry, so the winner was right but the replay graph, round-by-round table, History and AI recap all stopped one round short (room 536B on 2026-09-17: graph said Avi 110, standings said Manuel 130). That game's room log and `games` doc were repaired by hand. `roundCount` everywhere now means rounds actually scored (`roundsPlayed(room)` in history.ts), never `totalRounds`.
- **Round archives (2026-09-20, now server-side): the room snapshot only carries the current round.** Since 2026-09-21 the archives live in `EngineState.archives` on the game server and the finished snapshot carries the stitched `log` (`publicRoom`), so `useFullLog` just returns `room.log`; the Firestore paragraph that follows is the history of why. Every phone re-downloads the whole `rooms/{code}` doc on every change, and Firestore's wire encoding is 7 to 8 times the JSON size (measured: a 14.9 KB doc cost ~115 KB per play), so the ever-growing `log` + `trickHistory` made late rounds cost 100 KB+ per play per phone. Now `dealNextRound` / `scoreAndAdvance` / `finishGameNow` copy the finished round's bids, plays and trick wins to `rooms/{code}/rounds/{n}` (`RoundArchive`) in the same batch, prune them from `log` (`pruneRoundFromLog`) and reset `trickHistory`. Light entries (deal, trump, roundScore, gameOver) stay on the doc because live screens read them. Anything that needs the whole game (History save, the AI recap payload, the final round-by-round table) goes through `loadFullLog(code, room)` / `useFullLog`, which stitches archives and doc together and falls back to the doc for rounds played before this change. `resetForNewGame` deletes the archives with the hands. Rules have a `rounds` match.
- **Computer players run on the game server (2026-09-21).** `useBotDriver` is gone; `RoomDO` schedules an alarm (250 ms, 2.3 s when leading a new trick) whenever `engine.pendingBot()` says a computer is on the clock and plays it with the same `botAI`. A game with computers no longer depends on the host's phone being awake. **Finished-trick hold (2026-09-21 night):** the server resolves a trick the instant the last card lands, so the phones hold the finished trick for the 2 s win banner and `GameView` refuses to LEAD during that hold (`playLocked`); the bot lead delay is 2.3 s for the same reason. Before this the last card of a trick was gone before anyone saw it.
- **Room link previews (2026-09-21 night): `functions/` (the repo's first Cloud Function, `roomPage`, Node 24, us-central1).** Firebase Hosting rewrites `/room/**` to it; it fetches the live `index.html`, swaps the `<title>` and the `og:` / `twitter:` tags to "Wizard · Room ABCD" and serves it with `s-maxage=60`, so an iMessage / WhatsApp link shows the code and `public/og-card.png` (rendered by `node scripts/og-image/render.mjs` from `card.html`). Browsers get the same page as before. **Deploy is manual and must happen BEFORE a hosting deploy that carries the rewrite:** `firebase deploy --only functions:roomPage --project wizard-scores-2521c` (the Homebrew CLI; `npx firebase-tools` fails here with "Invalid Version"). CI deploys hosting + rules only. The lobby's invite button uses the share sheet on phones (`navigator.share` with the code in the text) and the clipboard elsewhere.
- **Chat box (2026-09-21 night):** the message list is a plain list (no frame) and the input is the one bordered field at 16px, after Jorge said people tapped the list instead of the field. Keep chat inputs at 16px: smaller makes iOS zoom the page on focus.
- **Trump call announcement:** when a Wizard is flipped and the dealer picks a suit, `CommentaryOverlay` shows "♥ HEARTS" with "Trump for this round, X's call" on every phone (fires on the null → suit transition within a round, so late joiners do not get a stale one).
- **`scripts/netlab/server-check.mjs`** drives the deployed server through a whole short game over raw sockets (lobby bots, rounds cap, undo vote, round-end vote, chat, finished full log, history + recap claims, play again, presence). Run it after any server change: `node scripts/netlab/server-check.mjs` must print ALL CHECKS PASSED.
- **Network test rig: `scripts/netlab/`.** `run.mjs` drives three real headless Chrome sessions (puppeteer-core + system Chrome) through real games against the production bundle (`vite preview`, workspace launch entry `wizard-preview`, port 4173) and records, per play, the time until each other player's snapshot shows it and the bytes they downloaded (`window.__wizardRoom` is exposed by Room.tsx for this). Bad networks are modelled by `shaper.mjs`, a userland link conditioner (HTTP CONNECT proxy for https, TCP forwarder for the local prototype) with a bandwidth cap and one-way delay per direction and an offline switch, one instance per player. **Do not use Chrome's own `Network.emulateNetworkConditions` for this: it does not limit the bandwidth of long-lived streams** (Firestore's channel, WebSockets), which is how the first night's numbers came out unthrottled. `report.mjs` aggregates the JSON results into tables. Profiles: slow3g (50 KB/s, 400 ms RTT), awful (12/6 KB/s, 800 ms RTT), flaky (slow3g + one player offline 8 s in 40). **Run ONE rig at a time**: two concurrent rigs share a Chrome process in practice, and when one run closes its browser every other run's pages die ("Attempted to use detached Frame"). Chain runs sequentially in one shell loop. Chrome's `Network.dataReceived` counts are the decompressed application bytes; the shaper's `wire` counts are the TLS bytes actually sent (Firestore gzips its channel, so wire is close to Chrome's count; the prototype's WebSocket uses permessage-deflate, so its wire count is far below the payload).
- **`netlab-do/`: Durable Object prototype of a server-authoritative room** (WebSocket hibernation, delta messages ~140 to 250 B per play, full state on (re)connect, 3 s ping / 6 s dead-link detection, reuses `src/game/*`). Runs locally with `npm run dev` in that folder (port 8787) and is deployed on Jorge's personal Cloudflare account as `wizard-netlab-do` (https://wizard-netlab-do.jrcanest.workers.dev) purely for measurement. It is NOT the game: no lobby, identity, bots, undo, votes, chat, presence or history.
- **Round-end screen:** `RoundScoreboard.tsx` (status `scoring`) is already the single post-round screen — results table + Next-round vote. Since 2026-09-02 it also shows a "Next up: round N · N cards · dealer X" line under the vote button, mirroring the scorekeeper's merged results/next-round screen.

---

# Original design spec

# Wizard Multiplayer

Sister app to the existing Wizard scorekeeper. Real-time multiplayer Wizard card game playable from phones, with shared history written back to the scorekeeper's existing history store.

## Stack

- React + Vite + TypeScript
- Game server: Cloudflare Worker + Durable Object (`server/`, WebSockets), one DO per room, since 2026-09-21
- Firebase: Firestore (players, History, reaction tally), Anonymous Auth (needed for the `reactionStats` writes), Hosting (the URL never changed)
- Tailwind for styling, matching scorekeeper conventions
- No external card-game libraries. Build the engine ourselves.

## Identity model

**Players** (global, shared with scorekeeper)
- Player record keyed by name (matching the scorekeeper's existing history shape)
- 4-digit PIN, stored as a hash (e.g. SHA-256 with a per-player salt) on the player doc
- On join: enter name + PIN. If name exists, PIN must match. If new, PIN is set on creation.
- PIN is global per player, not per room

**Rooms**
- 4-character alphanumeric code, uppercase, excluding ambiguous chars: no `0`, `O`, `1`, `I`, `L`
- Allowed alphabet: `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (32 chars, ~1M combinations)
- Generated by the Worker on `POST /rooms`; the DO answers 409 on a live collision and the Worker retries
- Rejoin via URL: `/room/ABCD` deep-links into the room and prompts for name/PIN if there is no seat token

**Seat token + Anonymous Auth**
- After the PIN check the app asks the game server for a seat token (`fetchSeatToken`, stored in the session); it is what the socket and room creation carry, and it is why opponents never see each other's hands (each socket only ever gets its own)
- Firebase anonymous auth still signs every device in on first load, only because `reactionStats` writes require it
- Both invisible to the user; a rotated `SESSION_SECRET` means one re-sign-in for everyone

## Game rules

Standard Wizard, 60-card deck (52 standard + 4 Wizards + 4 Jesters).

**Round structure**
- Round 1: 1 card per player (dealt regardless of player count)
- Each subsequent round: +1 card
- Total rounds = `floor(60 / playerCount)`
  - 3 players → 20 rounds
  - 4 → 15
  - 5 → 12
  - 6 → 10
  - 7 → 8
  - 8 → 7
  - 9 → 6
  - 10 → 6

**Trump**
- After dealing, top card of remaining deck is flipped as trump
- If trump is a Wizard: dealer chooses trump suit
- If trump is a Jester: no trump that round
- If no cards remain (final round in a 3-player game): no trump
- Last round always has no trump card if deck is exhausted

**Bidding**
- Player to dealer's left bids first, around to dealer last
- Each player bids 0 to (number of cards in hand)
- All bids visible to all players as they're made
- Display running total of bids vs. trick count throughout the round

**Canadian rule** (per-game toggle, set at room creation)
- Sum of all bids cannot equal the number of tricks in the round
- Constraint enforced on the dealer's bid (they bid last)
- Does NOT apply to round 1 (single-card round)
- When enforced: dealer's bid input disables the value that would balance the round

**Trick play**
- Player to dealer's left leads the first trick
- Lead suit = suit of first non-Jester card played
  - If the lead card is a Jester: lead suit is set by the next non-Jester card played
  - If a Wizard leads: trick is won by that Wizard, no lead suit established (but play continues; subsequent cards can be anything)
- Must follow lead suit if able. Wizards and Jesters always playable.
- Winner: first Wizard played wins; else highest trump; else highest card of lead suit; if all Jesters, the first Jester played wins
- Winner of trick leads the next

**Scoring**
- Exact bid: `20 + 10 * bid` (so bidding 0 and making 0 = 20 points)
- Missed bid: `-10 * |bid - tricksWon|`
- Cumulative across rounds, lowest can go negative

## Game state machine

```
lobby → dealing → bidding → playing → scoring
                                ↑__________|  (loop until rounds exhausted)
                                            ↓
                                         finished
```

`playing` repeats per trick within the round (small inner loop, not a separate state).

## State model (since 2026-09-21)

Firestore (shared with the scorekeeper, rules in `firestore.rules`):

```
players/{playerId}      name, nameLower, pinHash, pinSalt, pinSetAt, stats, aliases?, mergedInto?
games/{gameId}          finished games (History); results[] shape shared with the scorekeeper
reactionStats/{phrase}  all-rooms reaction tally
```

Game server (`server/`, one Durable Object per room code, persisted in DO storage as `EngineState`):

```
room      RoomDoc & { code }   status lobby|dealing|bidding|playing|scoring|finished, playerOrder,
                                dealerIndex, currentPlayerIndex, currentRound, totalRounds, trumpCard,
                                trumpSuit, leadSuit, bids, tricksWon, cumulativeScores, trickInProgress,
                                trickHistory, log (current round only until finished), bots, votes...
hands     { [playerName]: Card[] }        only your own hand is ever sent to your socket
archives  { [round]: RoundArchive }       finished rounds; stitched into room.log when finished
chat      ChatLine[]                      windows derived via chatWindowKey(room)
kickVotes, seated
```

`Card`: `{ suit: 'H'|'D'|'C'|'S'|null, rank: number|'W'|'J' }` where W = Wizard, J = Jester.

Socket protocol (`src/lib/socket.ts` ↔ `server/src/index.ts`): client sends `{t:'hello', join}`, `{t:'act', id, action, args}` and `'ping'` (auto-answered `'pong'`); server sends `{t:'state', seq, room, hand, players, chat?}` (full snapshot on every change and on every reconnect), `{t:'chat', msg}`, `{t:'ack', id, ok, result|code}` and `{t:'error', code}`. Error codes are `EngineError` codes from `src/game/engine.ts` plus `unauthorized`.

## Security

- `players` and `games` stay open in Firestore rules (scorekeeper compatibility); `reactionStats` needs anonymous auth.
- Seat token: `POST /session` verifies name + PIN against `players` (salted SHA-256, via the Firestore REST API) and mints a 60-day HMAC-SHA256 token signed with the Worker secret `SESSION_SECRET`. Every room create and every socket carries it, so a seat can only be taken by the person who knows the PIN, and hands are never sent to another seat.
- The server is authoritative: every action goes through the engine, illegal moves come back as an ack error, nothing is client-writable.

## Disconnect and vote-kick

- Presence = open socket. The server marks a seat `connected: false` the moment its socket closes (and on a missed ping: client pings every 3 s, gives up after 7 s and reconnects with back-off 500 ms to 4 s, with an immediate retry on `online` / `visibilitychange`).
- The game never stalls on a disconnect: the seat stays, the hand is kept, and on reconnect the socket gets a full snapshot plus its hand.
- Vote-kick (`setVoteKick` / `kickTally` / `executeKick` in the engine): available on a disconnected seat, majority of the remaining connected humans carries; the kicked player leaves `playerOrder`, their hand is discarded and the round resumes with adjusted turn order.

## Card assets

Cards live in a folder (Claude Code knows where). Pipeline:

1. Crop each card to remove white outline / borders
2. Round corners with a consistent radius
3. Normalize dimensions (target ratio ~2.5:3.5, e.g. 250×350 px source)
4. Optimize: convert to WebP with PNG fallback, target <30 KB per card
5. Output to `public/cards/` with naming convention `{suit}-{rank}.webp` (e.g. `H-7.webp`, `wizard-1.webp`, `jester-2.webp`)
6. Sprite sheet optional optimization once everything works

The processing should be a one-shot script (`scripts/process-cards.ts`) that's run manually, not part of the build.

## UI layout

**Phone-first, desktop tolerated.**

**Top zone (opponents)**
- 3-9 opponent tiles laid out responsively
- Each tile: avatar/initial, name, bid (once submitted), tricks won, face-down hand showing card count
- Active player highlighted with a glow/border
- At 9 opponents (10-player game) tiles compress into a 3×3 grid

**Middle zone**
- Trump card pinned left (with suit indicator if dealer chose on a Wizard flip)
- Trick area center: cards play in an arc, in play order, with the lead card visually anchored

**Bottom third (your hand)**
- Cards fanned, tap-to-play
- Legal cards full opacity; illegal cards at 40% opacity with `pointer-events: none`
- Bid input appears here during bidding phase (number stepper 0 to handSize)
- Score and round indicator pinned at the very top edge

**Animations**
- Stagger dealing client-side (cards fly to each player ~80ms apart)
- On trick complete: 1.2s pause, then cards animate to winner before next trick
- On round complete: scoring overlay shows bid vs. tricks vs. delta for each player

## Sound effects

- Card play
- Trick won (subtle)
- Round complete (chime)
- Game over (longer chime)
- Your turn (gentle alert, only if tab is backgrounded or after 5s of inactivity)
- Toggle in settings, default on, persist preference to localStorage

## History integration

Completed games write to the scorekeeper's existing history store (Claude Code knows the localStorage key and shape). The schema needs to remain compatible. Two options to investigate:

1. **Direct write**: if both apps share an origin (same Firebase Hosting site or same domain), both can read/write the same localStorage. Preferred.
2. **Sync layer**: if origins differ, write game results to Firestore under a per-player history collection and have the scorekeeper read from there as well. More work, more correct long-term.

Game log entries (every bid, every trick winner, final scores) get bundled into the history record so the scorekeeper can show a "view game log" link per game.

## Build order

1. Project scaffold: Vite + React + TS + Tailwind + Firebase config, anonymous auth flow, basic routing (`/`, `/room/:code`)
2. Player identity: name + PIN flow, players collection, hash/salt, claim-or-create
3. Room create + join: code generation, lobby UI, player list, ready states, host controls
4. Card assets pipeline: process-cards script, get all 60 cards rendered nicely
5. Deck + dealing: shuffle, deal hands, flip trump, render hands and trump card (no play yet)
6. Bidding phase: turn order, bid input, Canadian rule enforcement, all bids visible
7. Trick play: legal-card detection, play card, trick resolution, winner determination, lead-suit handling including Jester-leads and Wizard-leads
8. Round scoring: scoring overlay, cumulative scoreboard, advance to next round
9. Game completion: final scoreboard, write to scorekeeper history, "play again" flow
10. Disconnect handling: heartbeat, grace timer, vote-kick, reconnect-and-resume
11. Game log: structured log entries throughout, surfaced in history
12. SFX: hook up sounds, settings toggle
13. Polish: animations (deal, trick resolution, round transition), 10-player layout stress test, responsive desktop view

## Things to confirm during build

- Exact localStorage shape/key from the scorekeeper before writing history (read its repo first)
- Visual style audit: pull the scorekeeper's color tokens, typography, button styles into a shared tailwind config so the apps feel like siblings
- Card image source: confirm we have all 60 (52 standard + 4 Wizards + 4 Jesters distinguishable, e.g. by color/number)

## Conventions

- Match scorekeeper file structure and naming where possible
- Versioned migrations for any breaking Firestore schema change (`schemaVersion` field on room docs)
- Patch-don't-rewrite: prefer surgical edits to existing files over rewrites
- Output files versioned `_V01`, `_V02` for any one-off scripts (matches Jorge's convention)
