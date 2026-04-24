import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Card, HandDoc } from '../lib/types';

export function useMyHand(code: string, playerName: string | null) {
  const [hand, setHand] = useState<Card[] | null>(null);

  useEffect(() => {
    if (!playerName) {
      setHand(null);
      return;
    }
    const ref = doc(db, 'rooms', code, 'hands', playerName);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setHand(null);
        return;
      }
      const data = snap.data() as HandDoc;
      setHand(data.cards);
    });
  }, [code, playerName]);

  return hand;
}
