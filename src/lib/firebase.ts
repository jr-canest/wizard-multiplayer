import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Shared with the scorekeeper (project: wizard-scores-2521c).
// Both apps read/write the same `players` and `games` collections so history
// shows up in either app. Multiplayer-specific state lives under `rooms`.
const firebaseConfig = {
  apiKey: 'AIzaSyBT1yNBK3DyIk9GhiPc-heuBBBbjThlm88',
  authDomain: 'wizard-scores-2521c.firebaseapp.com',
  projectId: 'wizard-scores-2521c',
  storageBucket: 'wizard-scores-2521c.firebasestorage.app',
  messagingSenderId: '37372424805',
  appId: '1:37372424805:web:383851762365e1b6f3cc8c',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');

const generateGameSummaryFn = httpsCallable<
  AISummaryPayload,
  { summary: string }
>(functions, 'generateGameSummary');

export type AISummaryPayload = {
  players: Array<{
    name: string;
    score: number;
    rank: number;
    shamePoints: number;
  }>;
  roundCount: number;
  canadianRules: boolean;
  leadChanges: number;
  biggestLead: number;
  comebackRank: number | null;
  negativeCount: number;
  // Optional richer signals — multiplayer fills these in from the live
  // per-round log so the AI has concrete moments to riff on. The Cloud
  // Function ignores any field it doesn't understand.
  source?: 'multiplayer' | 'scorekeeper';
  wizardsPlayed?: number;
  jestersPlayed?: number;
  mostExactBids?: { name: string; count: number } | null;
  mostMissedBids?: { name: string; count: number } | null;
  bestSingleRound?: { name: string; delta: number; round: number } | null;
  worstSingleRound?: { name: string; delta: number; round: number } | null;
  finalRoundLeader?: { name: string; delta: number } | null;
};

/**
 * Calls the scorekeeper's generateGameSummary Cloud Function (shared
 * project). Returns the AI-written recap with <b>name</b> tags, or null
 * on error so callers fall back to the deterministic recap.
 */
export async function fetchAISummary(
  payload: AISummaryPayload,
): Promise<string | null> {
  try {
    const result = await generateGameSummaryFn(payload);
    const summary = result?.data?.summary;
    return typeof summary === 'string' && summary.length > 0
      ? summary
      : null;
  } catch (err) {
    console.warn('[firebase] AI summary failed:', err);
    return null;
  }
}

export function isProduction(): boolean {
  return (
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  );
}
