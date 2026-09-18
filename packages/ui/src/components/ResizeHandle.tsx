import { useCallback, useRef } from 'react';
import { useT } from '../lib/i18n.js';

/** The narrowest and widest a panel may be dragged to. */
export const MIN_SIDEBAR = 220;
export const MAX_SIDEBAR = 520;

export function clampSidebar(width: number): number {
  return Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, Math.round(width)));
}

/**
 * The divider between a panel and the rest of the page.
 *
 * Bounded on purpose. A free-form splitter can be dragged until one side is a sliver,
 * and the divider is then a few pixels wide on a page that looks broken — recoverable
 * only if you know it is there. The range here is wide enough to matter on a 13-inch
 * laptop and on a large monitor, and narrow enough that neither side can vanish.
 *
 * Pointer events, so it works with a finger on a tablet as well as a mouse; the cursor
 * is `col-resize` on hover, which is the thing that tells you it can be dragged at all.
 */
export function ResizeHandle({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (width: number) => void;
}) {
  const { t } = useT();
  const latest = useRef(width);
  latest.current = width;

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget as HTMLElement;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* not capturable */
      }
      const startX = event.clientX;
      const startWidth = latest.current;
      const previousSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const move = (moveEvent: PointerEvent): void => {
        onWidth(clampSidebar(startWidth + (moveEvent.clientX - startX)));
      };
      const end = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        document.body.style.userSelect = previousSelect;
        document.body.style.cursor = '';
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    },
    [onWidth],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('set.resize')}
      title={t('set.resize')}
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR}
      aria-valuemax={MAX_SIDEBAR}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        // Keyboard resizing, because a splitter you can only drag is a splitter some
        // people cannot use at all.
        if (event.key === 'ArrowLeft') onWidth(clampSidebar(width - 16));
        if (event.key === 'ArrowRight') onWidth(clampSidebar(width + 16));
      }}
      className="group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-(--color-line) md:block"
      style={{ touchAction: 'none' }}
    >
      {/* A wider invisible target than the visible line: 6px is hard to hit. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 block" />
      <span className="absolute inset-y-0 left-0 w-full bg-(--color-chord) opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" />
    </div>
  );
}
