/** Three soft dots that breathe in turn, the "someone is typing" mark. */
export function TypingDots({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[2px] ${className}`} aria-hidden="true">
      <span className="typing-dot" />
      <span className="typing-dot" style={{ animationDelay: '0.18s' }} />
      <span className="typing-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  );
}

/** "Avi is typing" with the dots, under a chat list; nothing when quiet. */
export function TypingLine({ names, className = '' }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  const who =
    names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} people`;
  return (
    <p className={`flex items-center gap-1.5 text-navy-300 ${className}`} aria-live="polite">
      <TypingDots className="text-navy-200" />
      <span>
        {who} {names.length === 1 ? 'is' : 'are'} typing
      </span>
    </p>
  );
}
