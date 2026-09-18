import { useCallback, useRef, useState } from 'react';
import { indexAtPoint, moveItem } from './reorder.js';

/**
 * Drag to reorder, with a finger or a mouse.
 *
 * Pointer events rather than HTML5 drag-and-drop, for one decisive reason: HTML5 drag
 * does not exist on touch, and sets get built on a tablet at a kitchen table as often
 * as on a laptop.
 *
 * Two details make it usable rather than merely functional:
 *
 *  - **A grip, not the whole row.** `touch-action: none` is set on the handle alone, so
 *    dragging anywhere else still scrolls the list. Put it on the row and a musician
 *    could no longer scroll their own set on a phone.
 *  - **Pointer capture.** Once a drag starts the handle receives every move even when
 *    the finger leaves it, which it always does. Without it the drag stops the moment
 *    you move faster than the list re-renders.
 */

export interface DragListResult {
  /** Spread onto the grip element of row `index`. */
  handleProps: (index: number) => {
    onPointerDown: (event: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Spread onto row `index` itself, so its position can be measured. */
  rowProps: (index: number) => {
    ref: (node: HTMLElement | null) => void;
    'data-dragging'?: true;
    'data-drop-target'?: true;
  };
  /** The row being dragged, or null. */
  dragging: number | null;
  /** Where it would land if released now. */
  target: number | null;
}

export function useDragList(onReorder: (from: number, to: number) => void): DragListResult {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  // Read inside listeners, which are registered once per drag and would otherwise
  // close over a stale target.
  const latestTarget = useRef<number | null>(null);

  const rowProps = useCallback(
    (index: number) => ({
      ref: (node: HTMLElement | null): void => {
        rows.current[index] = node;
      },
      ...(dragging === index ? { 'data-dragging': true as const } : {}),
      ...(dragging !== null && target === index && target !== dragging
        ? { 'data-drop-target': true as const }
        : {}),
    }),
    [dragging, target],
  );

  const handleProps = useCallback(
    (index: number) => ({
      style: { touchAction: 'none' as const, cursor: 'grab' as const },
      onPointerDown: (event: React.PointerEvent): void => {
        // Only a primary button or a finger; a right-click must not start a drag.
        if (event.button !== 0) return;
        event.preventDefault();

        const handle = event.currentTarget as HTMLElement;
        // Throws for a pointer id the browser no longer considers active, which happens
        // if the press was already released. The drag still works without capture; it
        // just stops tracking once the pointer leaves the handle.
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          /* not capturable */
        }
        setDragging(index);
        setTarget(index);
        latestTarget.current = index;

        // Rects are measured once, at the start. Re-measuring mid-drag would read the
        // positions of rows that have already shifted under the pointer, and the drop
        // index would chase itself.
        const rects = rows.current
          .filter((node): node is HTMLElement => node instanceof HTMLElement)
          .map((node) => {
            const box = node.getBoundingClientRect();
            return { top: box.top, height: box.height };
          });

        const move = (moveEvent: PointerEvent): void => {
          const next = indexAtPoint(rects, moveEvent.clientY);
          latestTarget.current = next;
          setTarget(next);
        };

        const end = (): void => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          const to = latestTarget.current;
          setDragging(null);
          setTarget(null);
          latestTarget.current = null;
          if (to !== null && to !== index) onReorder(index, to);
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      },
    }),
    [onReorder],
  );

  return { handleProps, rowProps, dragging, target };
}

export { moveItem };
