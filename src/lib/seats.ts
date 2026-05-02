/**
 * Seat layout for the table view. The local viewer always sits at slot 0
 * (bottom of the screen, outside the table). Other players are arranged
 * clockwise around the table on three sides — top, left column, right
 * column — to roughly mimic how players sit around a real table viewed
 * from above with the user at the south.
 *
 * Going clockwise from the viewer (south on a clock face), the path is:
 *   bottom → up the LEFT side → across the TOP → down the RIGHT side → bottom
 *
 * So the slot indices map to:
 *   slot 1                    → leftmost column, bottom
 *   slot 2..left              → going UP the left column
 *   slot left+1..left+top     → top row, LEFT to RIGHT
 *   slot left+top+1..N-1      → right column, TOP to BOTTOM
 */

export type SeatSide = 'left' | 'top' | 'right';
export type SeatPosition = { side: SeatSide; index: number };

/**
 * Distribute `opp` opponents across left/top/right edges. Even-as-possible
 * three-way split; remainder goes to top first, then left.
 */
export function distributeSeats(opp: number): {
  left: number;
  top: number;
  right: number;
} {
  if (opp <= 0) return { left: 0, top: 0, right: 0 };
  // 1–2 opponents look better at eye level (sides) than far away on top.
  if (opp === 1) return { left: 1, top: 0, right: 0 };
  if (opp === 2) return { left: 1, top: 0, right: 1 };
  const base = Math.floor(opp / 3);
  const extra = opp % 3;
  return {
    left: base + (extra >= 2 ? 1 : 0),
    top: base + (extra >= 1 ? 1 : 0),
    right: base,
  };
}

/**
 * Returns the seat position for each clockwise slot 1..N-1 (slot 0 is the
 * viewer at the bottom and is not included). `index` is the local index
 * within the side, ordered along the clockwise path:
 *   - left column: index 0 = bottom of column, increasing index goes UP
 *   - top row: index 0 = leftmost, increasing index goes RIGHT
 *   - right column: index 0 = top of column, increasing index goes DOWN
 */
export function seatPositions(opp: number): SeatPosition[] {
  const { left, top, right } = distributeSeats(opp);
  const out: SeatPosition[] = [];
  for (let i = 0; i < left; i++) out.push({ side: 'left', index: i });
  for (let i = 0; i < top; i++) out.push({ side: 'top', index: i });
  for (let i = 0; i < right; i++) out.push({ side: 'right', index: i });
  return out;
}

/**
 * Slot index of `playerName` from the local viewer's perspective.
 * Slot 0 is the viewer; slots 1..N-1 are clockwise around the table
 * starting with the player to the viewer's left (next in playerOrder).
 */
export function viewerSlotIndex(
  playerName: string,
  myName: string,
  playerOrder: string[],
): number {
  const seatIdx = playerOrder.indexOf(playerName);
  if (seatIdx < 0) return 0;
  const myIdx = playerOrder.indexOf(myName);
  if (myIdx < 0) return seatIdx;
  const N = playerOrder.length;
  return (seatIdx - myIdx + N) % N;
}

/**
 * Where in the table-shaped trick area a card played by a given seat
 * should land. Coordinates are relative to the trick area's center
 * (positive y = down, positive x = right). Cards are positioned near
 * the edge corresponding to their seat side and tilted slightly toward
 * the centre.
 *
 * For the local viewer (slot 0 = bottom), the card sits centered near
 * the bottom edge.
 */
export function trickSlotForSide(
  side: SeatSide | 'bottom',
  indexInSide: number,
  totalOnSide: number,
  fanW: number,
  fanH: number,
): { x: number; y: number; rot: number } {
  const halfW = fanW / 2;
  const halfH = fanH / 2;
  // Distance from each edge to the card centre. Picked so trick cards
  // (md ≈ 64×90) never overlap the trump frame in the middle (sm card
  // + label ≈ 60×100).
  const edgeMargin = 44;
  const center = (totalOnSide - 1) / 2;
  const stepX = Math.min(82, (fanW - 2 * edgeMargin) / Math.max(1, totalOnSide));
  const stepY = Math.min(72, (fanH - 2 * edgeMargin) / Math.max(1, totalOnSide));

  switch (side) {
    case 'top': {
      const offsetX = (indexInSide - center) * stepX;
      return { x: offsetX, y: -halfH + edgeMargin, rot: 0 };
    }
    case 'bottom': {
      return { x: 0, y: halfH - edgeMargin, rot: 0 };
    }
    case 'left': {
      // index 0 = bottom of column (closer to viewer). Bottom is +y.
      const offsetY = (center - indexInSide) * stepY;
      return { x: -halfW + edgeMargin, y: offsetY, rot: -8 };
    }
    case 'right': {
      // index 0 = top of column. Top is -y.
      const offsetY = (indexInSide - center) * stepY;
      return { x: halfW - edgeMargin, y: offsetY, rot: 8 };
    }
  }
}

/** Look up a player's seat (side + index + side total) for the local viewer. */
export function playerSeatInfo(
  playerName: string,
  myName: string,
  playerOrder: string[],
):
  | { side: SeatSide; index: number; totalOnSide: number }
  | { side: 'bottom'; index: 0; totalOnSide: 1 } {
  const slot = viewerSlotIndex(playerName, myName, playerOrder);
  if (slot === 0) return { side: 'bottom', index: 0, totalOnSide: 1 };
  const opp = playerOrder.length - 1;
  const positions = seatPositions(opp);
  const pos = positions[slot - 1];
  if (!pos) return { side: 'bottom', index: 0, totalOnSide: 1 };
  const { left, top, right } = distributeSeats(opp);
  const totalOnSide =
    pos.side === 'left' ? left : pos.side === 'top' ? top : right;
  return { side: pos.side, index: pos.index, totalOnSide };
}
