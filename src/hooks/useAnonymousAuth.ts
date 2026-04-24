import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../lib/firebase';

type AuthState = {
  uid: string | null;
  ready: boolean;
  error: string | null;
};

export function useAnonymousAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    uid: null,
    ready: false,
    error: null,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setState({ uid: user.uid, ready: true, error: null });
      } else {
        signInAnonymously(auth).catch((err: Error) => {
          setState({ uid: null, ready: true, error: err.message });
        });
      }
    });
    return unsub;
  }, []);

  return state;
}
