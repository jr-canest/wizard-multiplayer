import { useEffect, useState } from 'react';
import { subscribeChat, type ChatMessage } from '../lib/chat';

type State = { code: string; messages: ChatMessage[] };

/**
 * Live subscription to a room's chat subcollection. Separate from
 * useRoom on purpose: chat updates must not wait behind, or drag along,
 * the much larger room document.
 */
export function useChat(code: string): ChatMessage[] {
  const [state, setState] = useState<State>({ code, messages: [] });

  useEffect(
    () => subscribeChat(code, (messages) => setState({ code, messages })),
    [code],
  );

  // Stale-code guard instead of resetting state in an effect: on a room
  // switch the previous room's messages are simply not returned.
  return state.code === code ? state.messages : [];
}
