# Wizard Multiplayer

Real-time multiplayer Wizard card game. Sister app to [wizard-scorekeeper](https://github.com/jr-canest/wizard-scorekeeper) — shares the same Firebase project (`wizard-scores-2521c`) and writes finished games to the same `games` collection so history shows up in either app.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5181
```

## Deploy

Push to `main` — GitHub Actions builds and deploys Firebase Hosting (site `wizard-multiplayer`) plus Firestore rules.

Live at **https://wizard-multiplayer.web.app**. (The old GitHub Pages URL is a stale mirror.)

Manual fallback:

```bash
npm run build && npx firebase deploy --only hosting:multiplayer --project wizard-scores-2521c
```

## Stack

- React 19 + Vite 8 + TypeScript
- Tailwind v4 (matching scorekeeper theme tokens)
- React Router 7
- Firebase: Firestore + Anonymous Auth (project `wizard-scores-2521c`)

## Firebase setup (one-time)

1. **Enable Anonymous sign-in** in the Firebase console: Authentication → Sign-in method → Anonymous → enable.
2. **Deploy Firestore rules** when ready: `firebase deploy --only firestore:rules`.

See `CLAUDE.md` (in the parent `Wizard Game/` folder) for the full spec.
