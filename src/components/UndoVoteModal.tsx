import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestUndo, resolveExpiredUndo, voteUndo } from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { colorForViewer } from '../lib/playerColors';
import { CardImage } from './CardImage';
import { UNDO_VOTE_TTL_MS } from '../lib/types';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * Center-screen, table-wide vote on an undo request.
 *
 * While this is up the game is PAUSED: gameFlow refuses bids and plays,
 * and the bot driver holds off, so nobody can act their way past a vote
 * (which previously overwrote the pending snapshot and silently killed
 * it). The modal is deliberately big and in the middle, because the old
 * one-line strip above the hand was missed at the table.
 *
 * Every real player either approves or rejects. A majority approves the
 * undo; enough rejections to put that majority out of reach denies it on
 * the spot. A vote nobody answers expires, so one backgrounded phone
 * cannot freeze the table.
 */
export function UndoVoteModal({ room, myName }: Props) {
  const pu = room.pendingUndo;
  const open =
    !!pu?.requested &&
    (room.status === 'bidding' || room.status === 'playing');

  if (!open) return null;
  return <UndoVoteDialog room={room} myName={myName} />;
}

function UndoVoteDialog({ room, myName }: Props) {
  const pu = room.pendingUndo!;
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef(false);

  const openedAt = pu.requestedAt ?? now;
  const msLeft = Math.max(0, openedAt + UNDO_VOTE_TTL_MS - now);
  const secondsLeft = Math.ceil(msLeft / 1000);

  // Tick the countdown. Cheap, and it doubles as the expiry watchdog.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // Once the clock runs out, clear the vote so play resumes. Every client
  // races to do this and the transaction makes all but the first a no-op;
  // the ref keeps a single client from spamming it.
  useEffect(() => {
    if (msLeft > 0 || expiredRef.current) return;
    expiredRef.current = true;
    resolveExpiredUndo(room.code).catch(() => {
      expiredRef.current = false;
    });
  }, [msLeft, room.code]);

  const isActor = pu.actor === myName;
  const voters = room.playerOrder.filter((n) => !isBot(room, n));
  const threshold = Math.floor(voters.length / 2) + 1;
  const yes = pu.votes.filter((n) => voters.includes(n));
  const no = (pu.noVotes ?? []).filter((n) => voters.includes(n));
  const myVote = yes.includes(myName)
    ? 'yes'
    : no.includes(myName)
      ? 'no'
      : null;
  const waitingOn = voters.filter(
    (n) => !yes.includes(n) && !no.includes(n),
  );
  const actionWord = pu.kind === 'bid' ? 'bid' : 'card';
  const actorColor = colorForViewer(pu.actor, myName, room.playerOrder);

  async function onVote(voteYes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await voteUndo(room.code, myName, voteYes);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
    >
      {/* Opaque enough to read as "the game has stopped", and it swallows
          taps so nobody can act on the table underneath. */}
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
          Game paused
        </p>

        <p className="mt-2.5 text-[22px] leading-tight font-display font-semibold text-cream-bright">
          <span className={actorColor.text}>{isActor ? 'You' : pu.actor}</span>{' '}
          want{isActor ? '' : 's'} to undo
        </p>
        <p className="text-navy-100 text-[13px] mt-0.5">
          {isActor ? 'your' : 'their'} last {actionWord}
        </p>

        {/* What is actually on the table. */}
        {pu.kind === 'play' && pu.card ? (
          <div className="mt-3 flex justify-center">
            <CardImage card={pu.card} size="sm" />
          </div>
        ) : pu.kind === 'bid' && pu.bidValue !== undefined ? (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.18em] text-navy-200">
              Bid
            </span>
            <span className="chip px-3 py-1 text-[20px]">{pu.bidValue}</span>
          </div>
        ) : null}

        {/* Tally. */}
        <div className="mt-4 flex items-stretch gap-2">
          <Tally
            label="Approve"
            count={yes.length}
            total={threshold}
            tone="text-[#6ee7b7]"
          />
          <Tally
            label="Reject"
            count={no.length}
            total={voters.length - threshold + 1}
            tone="text-[#fda4af]"
          />
        </div>

        {waitingOn.length > 0 && (
          <p className="mt-2 text-[11px] text-navy-300 leading-tight">
            Waiting on {waitingOn.join(', ')}
          </p>
        )}

        {/* Buttons. */}
        {isActor ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary w-full mt-4 py-2.5 text-sm disabled:opacity-50"
          >
            Never mind, keep playing
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
              {myVote === 'no' ? '✓ Rejected' : 'Reject'}
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
              {myVote === 'yes' ? '✓ Approved' : 'Approve'}
            </button>
          </div>
        )}

        {/* Countdown: the vote closes itself so the table never sticks. */}
        <div className="mt-3.5">
          <div className="h-[3px] rounded-full bg-navy-900/80 overflow-hidden">
            <div
              className="h-full rounded-full bg-gold-300/70 transition-[width] duration-500 ease-linear"
              style={{ width: `${(msLeft / UNDO_VOTE_TTL_MS) * 100}%` }}
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
