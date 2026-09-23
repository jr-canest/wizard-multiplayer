import type { RoomDoc } from './types';

/** The seat after the dealer bids first and leads the first trick. */
export function firstBidder(room: Pick<RoomDoc, 'playerOrder' | 'dealerIndex'>): string | undefined {
  const n = room.playerOrder.length;
  return n ? room.playerOrder[(room.dealerIndex + 1) % n] : undefined;
}

export function leadsFirstTrick(room: Pick<RoomDoc, 'playerOrder' | 'dealerIndex'>, name: string): boolean {
  return firstBidder(room) === name;
}
