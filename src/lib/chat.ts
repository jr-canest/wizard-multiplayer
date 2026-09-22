/**
 * Chat rides the room socket: the server keeps the lines and sends each new
 * one to everyone. Windows (lobby / each round-end / final) work as before,
 * keyed by chatWindowKey, so a round-end conversation does not spill over.
 */
import { connectionFor } from './socket';
export { chatWindowKey, CHAT_MAX_LEN } from '../game/engine';
export type { ChatLine as ChatMessage } from './socket';

export async function sendChatMessage(code: string, _windowKey: string, _player: string, text: string, _ts?: number): Promise<void> {
  await connectionFor(code).act('sendChat', text);
}
