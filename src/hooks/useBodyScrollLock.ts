import { useEffect } from 'react';

// Module-level reference count so multiple modals open at once don't
// unlock the body until the LAST one closes. Single source of truth
// for the saved overflow value.
let lockCount = 0;
let savedOverflow: string | null = null;

/**
 * Lock the body scroll for as long as the calling component is
 * mounted. Used by modals so the page behind doesn't scroll under
 * them when the user swipes/scrolls inside the modal.
 *
 * Safe to use in nested modals — the body only unlocks when the last
 * holder unmounts.
 */
export function useBodyScrollLock(): void {
  useEffect(() => {
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow ?? '';
        savedOverflow = null;
      }
    };
  }, []);
}
