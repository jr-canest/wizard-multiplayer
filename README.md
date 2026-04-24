# Wizard Multiplayer

Real-time multiplayer Wizard card game. Sister app to [wizard-scorekeeper](https://github.com/jr-canest/wizard-scorekeeper) — shares the same Firebase project (`wizard-scores-2521c`) and writes finished games to the same `games` collection so history shows up in either app.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5181
```

## Deploy

GitHub Pages, same flow as the scorekeeper:

```bash
npm run deploy       # builds + pushes to gh-pages branch
```

Site lives at `https://jr-canest.github.io/wizard-multiplayer/` (once the repo is created and the `gh-pages` branch is pushed).

## Stack

- React 19 + Vite 8 + TypeScript
- Tailwind v4 (matching scorekeeper theme tokens)
- React Router 7
- Firebase: Firestore + Anonymous Auth (project `wizard-scores-2521c`)

## Firebase setup (one-time)

1. **Enable Anonymous sign-in** in the Firebase console: Authentication → Sign-in method → Anonymous → enable.
2. **Deploy Firestore rules** when ready: `firebase deploy --only firestore:rules`.

See `CLAUDE.md` (in the parent `Wizard Game/` folder) for the full spec.
