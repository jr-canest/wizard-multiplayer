/** Widest a row of bid chips gets before the numbers are too narrow to tap. */
const MAX_BID_COLS = 8;

/**
 * How to lay out `valueCount` bid chips: as few rows as fit within
 * MAX_BID_COLS, then columns balanced across those rows.
 *
 * The old rule was a flat 6 columns, so round 15 (16 values) came out as
 * 6 + 6 + 4: three rows, a ragged last one, and the felt squeezed to pay
 * for it. Balancing gives 8 + 8 and one row back.
 *
 * Shared because two places need the same answer: BidButtonsBar draws
 * the chips, and GameView decides whether the picker floats over the
 * felt or takes its own place in the layout, which is really the
 * question "is this more than one row".
 */
export function bidGridLayout(valueCount: number): {
  cols: number;
  rows: number;
} {
  const rows = Math.max(1, Math.ceil(valueCount / MAX_BID_COLS));
  const cols = Math.ceil(valueCount / rows);
  return { cols, rows };
}
