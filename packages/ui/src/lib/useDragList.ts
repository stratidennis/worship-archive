import { useCallback, useRef, useState } from 'react';
import { indexAtPoint, shiftFor } from './reorder.js';

/**
 * Drag to reorder, with a finger or a mouse.
 *
 * Pointer events rather than HTML5 drag-and-drop, for one decisive reason: HTML5 drag
 * does not exist on touch, and sets get built on a tablet at a kitchen table as often
 * as on a laptop.
 *
 * What the drag looks like is the whole point here. The row being dragged lifts off the
 * list and follows the pointer; the rows it passes slide out of its way, so the gap that
 * opens is the answer to "where will this end up". Nothing needs decoding — the list
 * shows you its future shape while you are still holding the item.
 *
 * Three details that make it work rather than merely animate:
 *
 *  - **A grip, not the whole row.** `touch-action: none` is set on the handle alone, so
 *    dragging anywhere else still scrolls the list. Put it on the row and a musician
 *    could no longer scroll their own set on a phone.
 *  - **Pointer capture.** Once a drag starts the handle receives every move even when
 *    the finger leaves it, which it always does.
 *  - **Positions measured once, at the grab.** The rows are moving; re-measuring
 *    mid-drag reads geometry that has already shifted and the target chases itself.
 *    The pointer is always compared against where the rows *started*.
 */

interface DragState {
  from: number;
  to: number;
  /** How far the pointer has travelled since the grab. */
  offset: number;
  rowHeight: number;
}

export interface DragListResult {
  /** Spread onto the grip element of row `index`. */
  handleProps: (index: number) => {
    onPointerDown: (event: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Spread onto row `index` itself: measured for position, transformed while dragging. */
  rowProps: (index: number) => {
    ref: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    'data-dragging'?: true;
  };
  /** The row being dragged, or null. */
  dragging: number | null;
  /** Where it would land if released now. */
  target: number | null;
}

export function useDragList(onReorder: (from: number, to: number) => void): DragListResult {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const [state, setState] = useState<DragState | null>(null);
  /*
    True for the single frame after a drop.

    On release two things happen at once: the list reorders, and the transforms that
    were holding rows out of the way go back to zero. Animating that would slide rows
    that already carry their *new* content, from positions that describe the old order —
    a visible flicker at the exact moment the user is checking their set is right. For
    one frame the transition is switched off, so the list simply is in its new shape.
  */
  const [settling, setSettling] = useState(false);
  // Read inside listeners registered once per drag, which would otherwise close over a
  // stale target.
  const latest = useRef<DragState | null>(null);

  const rowProps = useCallback(
    (index: number) => {
      const lifted = state?.from === index;
      const shift = state ? shiftFor(index, state.from, state.to, state.rowHeight) : 0;
      const offset = lifted ? state.offset : shift;

      const style: React.CSSProperties = {
        transform: offset === 0 ? undefined : `translateY(${offset}px)`,
        // The lifted row must track the pointer exactly; easing it would make it lag
        // behind the finger, which reads as the app being slow rather than smooth.
        transition: lifted || settling ? 'none' : 'transform 160ms cubic-bezier(0.2, 0, 0, 1)',
        ...(lifted
          ? {
              position: 'relative',
              zIndex: 20,
              scale: '1.02',
              borderRadius: '0.5rem',
              // Opaque, so the lifted row covers whatever slides underneath it.
              background: 'var(--color-stage-bg)',
              /*
                An accent outline plus an accent glow, not a black drop shadow. A dark
                shadow is the obvious choice and it is invisible on a near-black stage
                theme — the row lifted, and nothing looked like it had.
              */
              boxShadow:
                '0 0 0 2px var(--color-chord), 0 10px 26px -8px color-mix(in oklch, var(--color-chord) 70%, transparent)',
              cursor: 'grabbing',
            }
          : {}),
        ...(state ? { willChange: 'transform' } : {}),
      };

      return {
        ref: (node: HTMLElement | null): void => {
          rows.current[index] = node;
        },
        style,
        ...(lifted ? { 'data-dragging': true as const } : {}),
      };
    },
    [state, settling],
  );

  const handleProps = useCallback(
    (index: number) => ({
      style: { touchAction: 'none' as const, cursor: 'grab' as const },
      onPointerDown: (event: React.PointerEvent): void => {
        // Only a primary button or a finger; a right-click must not start a drag.
        if (event.button !== 0) return;
        event.preventDefault();

        const handle = event.currentTarget as HTMLElement;
        // Throws for a pointer id the browser no longer considers active. The drag still
        // works without capture; it just stops tracking once the pointer leaves.
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          /* not capturable */
        }

        const boxes = rows.current
          .filter((node): node is HTMLElement => node instanceof HTMLElement)
          .map((node) => {
            const box = node.getBoundingClientRect();
            return { top: box.top, height: box.height };
          });
        const rowHeight = boxes[index]?.height ?? 0;
        const grabbedAt = event.clientY;

        const begin: DragState = { from: index, to: index, offset: 0, rowHeight };
        latest.current = begin;
        setState(begin);

        // Text selection during a drag looks broken and, on touch, triggers the
        // magnifier over the whole list.
        const previousSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';

        const move = (moveEvent: PointerEvent): void => {
          const next: DragState = {
            from: index,
            to: indexAtPoint(boxes, moveEvent.clientY),
            offset: moveEvent.clientY - grabbedAt,
            rowHeight,
          };
          latest.current = next;
          setState(next);
        };

        const end = (): void => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          document.body.style.userSelect = previousSelect;
          const finished = latest.current;
          latest.current = null;
          setState(null);
          if (finished && finished.to !== finished.from) {
            setSettling(true);
            requestAnimationFrame(() => setSettling(false));
            onReorder(finished.from, finished.to);
          }
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      },
    }),
    [onReorder],
  );

  return {
    handleProps,
    rowProps,
    dragging: state?.from ?? null,
    target: state?.to ?? null,
  };
}
