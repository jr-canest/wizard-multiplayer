import { useEffect, useRef, useState, type ReactNode } from 'react';

// Covers the .felt-msg-out fold in index.css.
const EXIT_MS = 340;

/**
 * One slot in the felt's centred announcement column. When its content
 * goes away it keeps the last content for a short fold instead of
 * vanishing, so whatever sits next to it in the column glides into place
 * rather than jumping (Jorge, 2026-10-29: the "X won" banner disappearing
 * snapped the card under it to the middle). Same fold as the felt chat.
 */
export function FoldSlot({ children }: { children: ReactNode | null }) {
  const live = children != null && children !== false;
  const lastRef = useRef<ReactNode>(null);
  const [leaving, setLeaving] = useState(false);
  const [wasLive, setWasLive] = useState(live);
  if (wasLive !== live) {
    setWasLive(live);
    setLeaving(!live);
  }
  useEffect(() => {
    if (live) lastRef.current = children;
  });
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  if (!live && !leaving) return null;
  return (
    <div className={`felt-msg${live ? '' : ' felt-msg-out'}`}>
      <div className="flex flex-col items-center">
        {/* eslint-disable-next-line react-hooks/refs -- the last content, shown only while it folds away */}
        <div className="py-1">{live ? children : lastRef.current}</div>
      </div>
    </div>
  );
}
