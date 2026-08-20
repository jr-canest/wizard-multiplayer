# Wizard Multiplayer — current state (2026-08)

- **Live:** https://wizard-multiplayer.web.app (Firebase Hosting, target `multiplayer`, project `wizard-scores-2521c`, shared with wizard-scorekeeper). The old GitHub Pages URL is a stale mirror — do not use.
- **Deploy:** push to `main` = CI deploy (GitHub Actions → Firebase hosting + firestore rules). Manual fallback: `npm run build && firebase deploy --only hosting:multiplayer --project wizard-scores-2521c`.
- **Run locally:** `npm install && npm run dev` (port 5181). Firestore writes to shared history are skipped on localhost.
- **Test link:** `?test` on the home page unlocks the "add 3 bots" panel (pre-checked). Bot games and games with a player named `test` are never written to shared history.
- **Design:** "1b Evolve" kit (2026-08-19), shared with wizard-scorekeeper — spec in the design handoff; kit classes in `src/index.css` (`.btn-gold`, `.card-gold(-active/-subtle)`, `.chip*`, `.felt`, `.eyebrow`, `.ornament`). Kit classes are unlayered CSS and beat Tailwind utilities.
- **Typography rules (2026-08-20, both apps):** serif (`font-display`, Cormorant Garamond) = IDENTITY/NARRATIVE only — screen titles, player names, room codes, AI recap prose; never below 13px. Sans = ALL numerals (always `tabular-nums`, semibold/bold), labels, buttons, chips, status words. Numerals are NEVER serif.
- Keep both apps visually in lockstep — anything added to one index.css kit should land in the other.

---

# Original design spec

# Wizard Multiplayer

Sister app to the existing Wizard scorekeeper. Real-time multiplayer Wizard card game playable from phones, with shared history written back to the scorekeeper's existing history store.

## Stack

- React + Vite + TypeScript
- Firebase: Firestore (realtime state), Anonymous Auth (per-device UID for security rules), Hosting
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
- Generate, check Firestore for collision, retry on hit
- Rejoin via URL: `/room/ABCD` deep-links into the room and prompts for name/PIN if not authed

**Anonymous Auth**
- Every device gets a Firebase anonymous UID on first load
- Used only for security rules so opponents can't read each other's hands via dev tools
- Invisible to the user

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

## Firestore schema

```
players/{playerName}
  pinHash: string
  salt: string
  createdAt: timestamp
  lastSeenAt: timestamp

rooms/{code}
  status: 'lobby' | 'dealing' | 'bidding' | 'playing' | 'scoring' | 'finished'
  hostPlayerId: string
  canadianRule: boolean
  createdAt: timestamp
  playerOrder: string[]              // playerNames in seat order
  dealerIndex: number
  currentPlayerIndex: number
  currentRound: number               // 1-indexed
  totalRounds: number
  trumpCard: Card | null
  trumpSuit: Suit | null             // resolved trump (after dealer choice on Wizard flip)
  leadSuit: Suit | null
  bids: { [playerName]: number }
  tricksWon: { [playerName]: number }
  cumulativeScores: { [playerName]: number }
  trickInProgress: Array<{ playerName, card, playOrder }>
  trickHistory: Array<{ round, trickNum, plays, winner }>
  log: Array<LogEntry>               // game log, written to history on finish

rooms/{code}/hands/{playerName}
  cards: Card[]
  // Security rule: only readable if request.auth.uid == player's authUid

rooms/{code}/players/{playerName}
  authUid: string                    // Firebase anonymous UID, written on join
  connected: boolean
  lastHeartbeatAt: timestamp
  voteKickAgainst: string | null     // playerName they're voting to kick, or null
```

`Card`: `{ suit: 'H'|'D'|'C'|'S'|null, rank: number|'W'|'J' }` where W = Wizard, J = Jester.

## Security rules (sketch)

- `players/{name}`: readable by anyone (for name lookup), writable only with matching PIN check via Cloud Function or initial creation
- `rooms/{code}`: readable by any player listed in `playerOrder`, writable with field-level constraints
- `rooms/{code}/hands/{playerName}`: readable only by matching `authUid`, writable only by server logic (or constrained client writes during deal)
- `rooms/{code}/players/{playerName}`: readable by all room players, writable only by matching `authUid` (for connected/heartbeat)

Start client-authoritative with rules constraining writes. Move to Cloud Functions for move validation only if cheating becomes a concern.

## Disconnect and vote-kick

**Heartbeat**
- Each client writes `lastHeartbeatAt` every 10 seconds while in a room
- A player is `connected: false` if heartbeat is older than 30 seconds

**On player's turn while disconnected**
- 60-second grace timer starts when their turn begins and they're disconnected
- During grace period: UI shows "Waiting for {name}... 45s"
- After 60s: any other player can initiate a vote-kick
- Vote-kick passes with majority of remaining connected players
- On kick: player is removed from `playerOrder`, their hand is discarded, round resumes with adjusted turn order
  - If kicked mid-round, that player's bid is treated as auto-failed (they get `-10 * bid` if they had bid, 0 if they hadn't bid yet)

**On reconnect**
- Client reads room state, restores hand from `rooms/{code}/hands/{playerName}`, resumes
- If they were mid-turn, they get the remainder of their grace period

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
