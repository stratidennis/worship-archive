/**
 * Moving an item within a list, and working out where a drag would drop it.
 *
 * Split out from the drag hook because this is the part that can be wrong in ways a
 * screenshot will not show: an off-by-one when dragging downwards reorders the service
 * into something the band did not rehearse. Pure functions, tested.
 */

/** Move the item at `from` so that it ends up at index `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  const clamped = Math.max(0, Math.min(to, items.length - 1));
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * Which index a pointer at `y` is currently over.
 *
 * Uses each row's midpoint: past halfway means the drop goes after that row, which is
 * what makes a drag feel like it follows the finger rather than snapping late. Rows may
 * be different heights — a song row is taller than a gap — so this cannot be arithmetic
 * on a fixed row height.
 */
export function indexAtPoint(
  rects: readonly { top: number; height: number }[],
  y: number,
): number {
  if (rects.length === 0) return 0;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    if (y < rect.top + rect.height / 2) return i;
  }
  return rects.length - 1;
}

/**
 * How far row `index` should be pushed while a drag is in progress.
 *
 * This is what makes a drag readable: the rows between where the item came from and
 * where it is going slide out of the way, so the gap that opens up *is* the answer to
 * "where will this land". A thin line between two rows says the same thing in a way you
 * have to decode; a hole the shape of the row does not.
 *
 * Returns pixels, positive meaning downwards. The dragged row itself is excluded — it
 * follows the pointer instead, and its offset is not a function of the list.
 */
export function shiftFor(index: number, from: number, to: number, rowHeight: number): number {
  if (index === from) return 0;
  // Dragging down: everything it has passed moves up into the space it left.
  if (from < to && index > from && index <= to) return -rowHeight;
  // Dragging up: everything it has passed moves down.
  if (to < from && index >= to && index < from) return rowHeight;
  return 0;
}
