import { useUpdateCheck } from '../hooks/useUpdateCheck';
import { formatVersion } from '../lib/appVersion';

const BANNER_HEIGHT = 40;

// Sticky strip pinned above every screen once a newer build is live.
// Not dismissable — the only way past it is Update, which reloads the
// page. Nothing is lost: the game lives in the room document, and the
// URL keeps the room code, so the reload lands straight back in the seat.
export function UpdateBanner() {
  const liveVersion = useUpdateCheck();
  if (liveVersion == null) return null;

  return (
    <div
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-3.5 bg-[#1a2340] border-b border-gold-300/40 text-cream"
      style={{ height: BANNER_HEIGHT }}
    >
      <div className="min-w-0">
        <div className="text-[12px] font-semibold leading-tight truncate">New version available</div>
        <div className="text-[10px] text-navy-200 leading-tight truncate tabular-nums">
          {formatVersion(liveVersion)} · your seat is kept
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn-gold h-7 px-3.5 text-[12px] shrink-0"
      >
        Update
      </button>
    </div>
  );
}
