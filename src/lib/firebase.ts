import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

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

export function isProduction(): boolean {
  return (
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  );
}
