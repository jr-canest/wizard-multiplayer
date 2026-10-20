import { CHAT_REACTIONS, reactToChat, type ChatMessage } from '../lib/chat';

/** Reactions grouped by emoji, in picker order: [['😂', 2], ['❤️', 1]]. */
export function groupReactions(r: Record<string, string> | undefined): [string, number][] {
  if (!r) return [];
  const counts = new Map<string, number>();
  for (const e of Object.values(r)) counts.set(e, (counts.get(e) ?? 0) + 1);
  return CHAT_REACTIONS.filter((e) => counts.has(e)).map((e) => [e, counts.get(e)!]);
}

/** The small pill of reactions at a line's bottom-right. */
export function ReactionBadges({
  r,
  myName,
  className = '',
}: {
  r: Record<string, string> | undefined;
  myName: string;
  className?: string;
}) {
  const groups = groupReactions(r);
  if (groups.length === 0) return null;
  const mine = r?.[myName];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-navy-900/95 ring-1 px-1.5 py-[1px] text-[11px] leading-none shadow-md whitespace-nowrap ${
        mine ? 'ring-gold-300/70' : 'ring-gold-700/60'
      } ${className}`}
      title={Object.entries(r ?? {}).map(([n, e]) => `${n} ${e}`).join(', ')}
    >
      {groups.map(([e, n]) => (
        <span key={e} className="inline-flex items-center gap-[2px]">
          <span>{e}</span>
          {n > 1 && <span className="text-[10px] font-semibold tabular-nums text-navy-100">{n}</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * One chat line you can react to (2026-10-20): tap it and a small row of
 * 😂 👍 ❤️ opens under it; pick one (one per person, the same again takes
 * it off). Reactions sit small at the line's bottom-right. Lines still on
 * their way to the server and table notices ("X left") take none.
 */
export function ChatLine({
  line,
  code,
  myName,
  nameClass,
  textClass = 'text-navy-50',
  className = '',
  picking,
  onPick,
}: {
  line: ChatMessage & { pending?: boolean };
  code: string;
  myName: string;
  nameClass: string;
  textClass?: string;
  className?: string;
  /** This line's picker is the open one. */
  picking: boolean;
  /** Open (key) or close (null) the picker; one open at a time. */
  onPick: (key: string | null) => void;
}) {
  const key = `${line.player}-${line.ts}`;
  const reactable = !line.pending && !line.sys;
  const mine = line.r?.[myName];

  if (line.sys) {
    return (
      <p className={`${className} italic text-navy-300`}>
        <span className={`${nameClass} font-semibold not-italic`}>{line.player}</span> {line.text}
      </p>
    );
  }

  return (
    <div className={className}>
      <div
        role={reactable ? 'button' : undefined}
        tabIndex={reactable ? 0 : undefined}
        onClick={reactable ? () => onPick(picking ? null : key) : undefined}
        className={`flex items-end gap-1.5 rounded-md -mx-1 px-1 ${reactable ? 'cursor-pointer' : ''} ${
          picking ? 'bg-navy-700/50' : ''
        }`}
      >
        <p className="flex-1 min-w-0 break-words">
          <span className={`${nameClass} font-bold`}>{line.player}</span>
          <span className={textClass}>: {line.text}</span>
        </p>
        <ReactionBadges r={line.r} myName={myName} className="mb-[2px]" />
      </div>
      {picking && (
        <div className="flex justify-end pt-1 pb-0.5 animate-overlay-banner-inline">
          <div className="inline-flex gap-0.5 rounded-full border border-gold-300/60 bg-navy-900 px-1 py-0.5 shadow-lg">
            {CHAT_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`React ${e}`}
                onClick={() => {
                  onPick(null);
                  void reactToChat(code, line, e).catch(() => {});
                }}
                className={`w-7 h-7 rounded-full text-[16px] leading-none flex items-center justify-center active:scale-90 transition ${
                  mine === e ? 'bg-gold-500/30 ring-1 ring-gold-300/70' : ''
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
