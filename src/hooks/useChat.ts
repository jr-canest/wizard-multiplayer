import { useEffect, useState } from 'react';
import { acquireConnection, peekChat, releaseConnection, type ChatLine } from '../lib/socket';
import { useSession } from './useSession';

/** Chat lines for this room, live from the socket. */
export function useChat(code: string): ChatLine[] {
  const [chat, setChat] = useState<ChatLine[]>(() => peekChat(code));
  const token = useSession().session?.token ?? null;

  useEffect(() => {
    const conn = acquireConnection(code, true, token);
    const unsub = conn.subscribe((s) => setChat(s.chat));
    return () => {
      unsub();
      releaseConnection(code);
    };
  }, [code, token]);

  return chat;
}
