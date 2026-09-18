import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  /** Small red eyebrow, e.g. "Game paused" or "Vote". */
  eyebrow: string;
  /** The big serif line: who wants what. */
  title: ReactNode;
  /** One-line detail under the title. */
  subtitle?: ReactNode;
  /** Optional block showing what is on the table (a card, a bid). */
  detail?: ReactNode;
  yesCount: number;
  yesNeeded: number;
  noCount: number;
  noNeeded: number;
  /** Names still to answer. */
  waitingOn: string[];
  /** The viewer's own current vote, if any. */
  myVote: 'yes' | 'no' | null;
  /** True when the viewer opened the vote: they get Cancel, not Yes/No. */
  isOpener: boolean;
  cancelLabel: string;
  yesLabel?: string;
  noLabel?: string;
  busy: boolean;
  onVote: (yes: boolean) => void;
  onCancel: () => void;
  /** Epoch ms the vote opened and how long it lives. */
  openedAt: number;
  ttlMs: number;
  /** Called once when the clock runs out. */
  onExpire: () => Promise<void> | void;
};

/**
 * The one table-wide vote box: center-screen, over a backdrop that reads
 * as "everyone stop and answer this". Used for undo requests and for
 * the round-end votes (next round / last round / end game), so they all
 * look and behave the same: a tally each way, yes/no for everyone but
 * the opener, and a countdown after which any client clears the vote so
 * a sleeping phone can never hold the table.
 */
export function VoteModal(props: Props) {
  const {
    eyebrow,
    title,
    subtitle,
    detail,
    yesCount,
    yesNeeded,
    noCount,
    noNeeded,
    waitingOn,
    myVote,
    isOpener,
    cancelLabel,
    yesLabel = 'Yes',
    noLabel = 'No',
    busy,
    onVote,
    onCancel,
    openedAt,
    ttlMs,
    onExpire,
  } = props;

  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef(false);
  const msLeft = Math.max(0, openedAt + ttlMs - now);
  const secondsLeft = Math.ceil(msLeft / 1000);

  // Tick the countdown. Cheap, and it doubles as the expiry watchdog.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // Once the clock runs out, ask the caller to clear the vote. Every
  // client races to do this and the server-side guard makes all but the
  // first a no-op; the ref keeps a single client from spamming it.
  useEffect(() => {
    if (msLeft > 0 || expiredRef.current) return;
    expiredRef.current = true;
    Promise.resolve(onExpire()).catch(() => {
      expiredRef.current = false;
    });
  }, [msLeft, onExpire]);

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
    >
      {/* Opaque enough to read as "stop", and it swallows taps so nobody
          can act on the table underneath. */}
      <div className="absolute inset-0 bg-navy-950/80 backdrop-blur-[2px]" />

      <div
        className="relative w-full max-w-[340px] rounded-2xl p-5 animate-bid-modal-in text-center"
        style={{
          border: '1px solid #d4a843',
          background:
            'linear-gradient(180deg,rgba(40,33,20,.97),rgba(10,16,32,.98))',
          boxShadow:
            '0 0 40px rgba(212,168,67,.35), 0 18px 40px rgba(0,0,0,.7)',
        }}
      >
        <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-rose-300">
          {eyebrow}
        </p>

        <p className="mt-2.5 text-[22px] leading-tight font-display font-semibold text-cream-bright">
          {title}
        </p>
        {subtitle && (
          <p className="text-navy-100 text-[13px] mt-0.5">{subtitle}</p>
        )}

        {detail && <div className="mt-3 flex justify-center">{detail}</div>}

        <div className="mt-4 flex items-stretch gap-2">
          <Tally label={yesLabel} count={yesCount} total={yesNeeded} tone="text-[#6ee7b7]" />
          <Tally label={noLabel} count={noCount} total={noNeeded} tone="text-[#fda4af]" />
        </div>

        {waitingOn.length > 0 && (
          <p className="mt-2 text-[11px] text-navy-300 leading-tight">
            Waiting on {waitingOn.join(', ')}
          </p>
        )}

        {isOpener ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary w-full mt-4 py-2.5 text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onVote(false)}
              disabled={busy}
              className={`py-3 rounded-lg text-sm font-bold border transition active:scale-[0.98] disabled:opacity-50 ${
                myVote === 'no'
                  ? 'bg-rose-700/45 border-rose-400 text-rose-50'
                  : 'bg-[rgba(20,26,44,.8)] border-rose-500/45 text-rose-200'
              }`}
            >
              {myVote === 'no' ? `✓ ${noLabel}` : noLabel}
            </button>
            <button
              type="button"
              onClick={() => onVote(true)}
              disabled={busy}
              className={`py-3 rounded-lg text-sm font-bold border transition active:scale-[0.98] disabled:opacity-50 ${
                myVote === 'yes'
                  ? 'bg-emerald-700/45 border-emerald-400 text-emerald-50'
                  : 'bg-[rgba(20,26,44,.8)] border-emerald-500/45 text-emerald-200'
              }`}
            >
              {myVote === 'yes' ? `✓ ${yesLabel}` : yesLabel}
            </button>
          </div>
        )}

        <div className="mt-3.5">
          <div className="h-[3px] rounded-full bg-navy-900/80 overflow-hidden">
            <div
              className="h-full rounded-full bg-gold-300/70 transition-[width] duration-500 ease-linear"
              style={{ width: `${(msLeft / ttlMs) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-navy-400 tabular-nums">
            Vote closes in {secondsLeft}s
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Tally({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  return (
    <div className="flex-1 rounded-lg bg-navy-900/60 border border-gold-700/30 py-2">
      <p className="section-label">{label}</p>
      <p className={`${tone} font-bold tabular-nums text-[20px] leading-none mt-1`}>
        {count}
        <span className="text-navy-400 text-[13px]">/{total}</span>
      </p>
    </div>
  );
}
