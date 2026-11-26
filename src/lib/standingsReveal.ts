// The round-results reveal (Jorge, 2026-11-26): rows start where the table
// stood BEFORE the round, the round's points land and the totals roll,
// then the rows slide to their new places, and last the commentary pops.
// SHARED VERBATIM with the scorekeeper (src/utils/standingsReveal.ts).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 0 old order + old totals · 1 points in, totals rolling · 2 rows moving
 *  to the new order · 3 settled, commentary showing. */
export type RevealStage = 0 | 1 | 2 | 3;

export const REVEAL_POINTS_MS = 450;
export const REVEAL_MOVE_MS = 1450;
export const REVEAL_DONE_MS = 2350;
const MOVE_MS = 780;

// Rounds already revealed on this device: coming back to the screen (a
// re-mount, an edit, a vote landing) shows the settled table at once.
const SEEN = new Set<string>();

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Drives the reveal for one round. Mount it under a `key` that changes
 * with the round. `listRef` goes on the element that holds the rows and
 * each row carries `data-row-id`; rows are siblings (their offsetTop is
 * what gets animated, so page zoom is moot).
 */
export function useStandingsReveal(
  key: string,
  beforeOrder: string[],
  afterOrder: string[],
  /** Called as each step starts (1 points, 2 rows move, 3 commentary): sounds hang off this. */
  onStage?: (stage: RevealStage, rowsMove: boolean) => void,
) {
  const [stage, setStage] = useState<RevealStage>(() => (SEEN.has(key) || reducedMotion() ? 3 : 0));
  const listRef = useRef<HTMLDivElement | null>(null);
  const eachRow = (fn: (el: HTMLElement, id: string) => void) => {
    listRef.current?.querySelectorAll<HTMLElement>(':scope > [data-row-id]').forEach((el) => fn(el, el.dataset.rowId ?? ''));
  };
  const firstTops = useRef<Map<string, number> | null>(null);
  const onStageRef = useRef(onStage);
  useEffect(() => { onStageRef.current = onStage; });

  useEffect(() => {
    if (SEEN.has(key) || reducedMotion()) return;
    // Marked as seen only when it has played through: React's dev mode
    // runs this effect twice, and marking up front left the second run
    // with nothing to do and the first run's timers cleared.
    const rowsMove = beforeOrder.join('\n') !== afterOrder.join('\n');
    const timers = [
      window.setTimeout(() => { setStage(1); onStageRef.current?.(1, rowsMove); }, REVEAL_POINTS_MS),
      window.setTimeout(() => {
        const tops = new Map<string, number>();
        eachRow((el, id) => tops.set(id, el.offsetTop));
        firstTops.current = tops;
        setStage(2);
        onStageRef.current?.(2, rowsMove);
      }, REVEAL_MOVE_MS),
      window.setTimeout(() => { SEEN.add(key); setStage(3); onStageRef.current?.(3, rowsMove); }, REVEAL_DONE_MS),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
    // The orders are fixed for a round; only the key restarts the show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // FLIP: the rows are already in their new places in the document; put
  // each back where it was with a transform, then let it glide home.
  useLayoutEffect(() => {
    if (stage !== 2 || !firstTops.current) return;
    const tops = firstTops.current;
    firstTops.current = null;
    const moved: HTMLElement[] = [];
    eachRow((el, id) => {
      const dy = (tops.get(id) ?? el.offsetTop) - el.offsetTop;
      if (!dy) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.dataset.moving = dy > 0 ? 'up' : 'down';
      moved.push(el);
    });
    if (!moved.length) return;
    // Read once so the starting transform is committed before the glide.
    void moved[0].offsetHeight;
    for (const el of moved) {
      el.style.transition = `transform ${MOVE_MS}ms cubic-bezier(.2,.85,.25,1)`;
      el.style.transform = 'translateY(0)';
    }
    const done = window.setTimeout(() => {
      for (const el of moved) { el.style.transition = ''; el.style.transform = ''; delete el.dataset.moving; }
    }, MOVE_MS + 40);
    return () => window.clearTimeout(done);
  }, [stage]);

  return { stage, order: stage >= 2 ? afterOrder : beforeOrder, listRef };
}

/** A number that rolls from `from` to `to` once `run` turns true. */
export function useRolledNumber(from: number, to: number, run: boolean, ms = 750): number {
  // Already running at mount = this round was revealed before: no roll.
  const [instant] = useState(run);
  const [rolled, setRolled] = useState<number | null>(null);
  useEffect(() => {
    if (!run || instant || reducedMotion() || from === to) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setRolled(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to, run, instant, ms]);
  if (!run) return from;
  if (instant || from === to || reducedMotion()) return to;
  return rolled ?? from;
}
