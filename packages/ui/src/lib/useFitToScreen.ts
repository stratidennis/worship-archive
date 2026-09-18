import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Fit a whole song onto one screen.
 *
 * > "A nice thing about the old app is that the whole song is always displayed on one
 * > page, and there is no need to have it displayed on multiple pages."
 *
 * A musician mid-song must never scroll, swipe, or lose their place, so font size is an
 * *output* of layout rather than a setting. The per-device "max font" preference is a
 * ceiling the algorithm may come down from.
 *
 * Strategy, in order of preference:
 *   1. one column at the largest size that fits
 *   2. more columns, if the container is wide enough — two readable columns beat one
 *      column of shrunken text
 *   3. the largest size that fits at the best column count
 *   4. if nothing fits even at the minimum, report `fits: false` so the caller can
 *      offer block mode rather than rendering something illegible
 *
 * Measurement is done by mutating the real node and reading `scrollHeight`, inside
 * `useLayoutEffect`, so nothing intermediate is ever painted.
 */

export interface FitOptions {
  minFontPx?: number;
  maxFontPx?: number;
  /** Change this when the content changes, to force a re-fit. */
  key?: unknown;
}

export interface FitResult {
  fontPx: number;
  columns: number;
  /** False when the song overflows even at the minimum size — the honest failure. */
  fits: boolean;
  /** True while measuring, so the caller can avoid showing a flash of wrong sizes. */
  measuring: boolean;
}

const MIN_DEFAULT = 11;
const MAX_DEFAULT = 40;

/** Column counts worth trying at a given width. Columns are useless on a phone. */
function columnCandidates(width: number): number[] {
  if (width < 620) return [1];
  if (width < 1100) return [1, 2];
  return [1, 2, 3];
}

export function useFitToScreen(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: FitOptions = {},
): FitResult {
  const minFont = options.minFontPx ?? MIN_DEFAULT;
  const maxFont = options.maxFontPx ?? MAX_DEFAULT;
  const [result, setResult] = useState<FitResult>({
    fontPx: maxFont,
    columns: 1,
    fits: true,
    measuring: true,
  });
  const frame = useRef<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const measure = (): void => {
      const available = container.clientHeight;
      const width = container.clientWidth;
      if (available <= 0 || width <= 0) {
        // Nothing to measure against yet (hidden tab, zero-height parent). Show the
        // content at the preferred size rather than leaving it invisible — an
        // unmeasured song is far better than a blank screen.
        setResult((previous) =>
          previous.measuring ? { ...previous, measuring: false } : previous,
        );
        return;
      }

      const original = { fontSize: content.style.fontSize, columns: content.style.columnCount };

      const overflows = (fontPx: number, columns: number): boolean => {
        content.style.fontSize = `${fontPx}px`;
        content.style.columnCount = String(columns);
        // A column layout can also overflow horizontally if a single block is too wide.
        return content.scrollHeight > available + 1;
      };

      let best = { fontPx: minFont, columns: 1, fits: false };

      for (const columns of columnCandidates(width)) {
        if (!overflows(maxFont, columns)) {
          best = { fontPx: maxFont, columns, fits: true };
          break; // Fewer columns is always preferable at the same size.
        }
        // Largest size in [minFont, maxFont] that fits, to the nearest pixel.
        let low = minFont;
        let high = maxFont;
        let found = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (overflows(mid, columns)) high = mid - 1;
          else {
            found = mid;
            low = mid + 1;
          }
        }
        if (found > best.fontPx || (found > 0 && !best.fits)) {
          best = { fontPx: found, columns, fits: true };
        }
        if (best.fits && best.fontPx >= maxFont) break;
      }

      content.style.fontSize = original.fontSize;
      content.style.columnCount = original.columns;

      setResult((previous) =>
        previous.fontPx === best.fontPx &&
        previous.columns === best.columns &&
        previous.fits === best.fits &&
        !previous.measuring
          ? previous
          : { ...best, measuring: false },
      );
    };

    const schedule = (): void => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // `key` re-runs the fit when the content itself changed: transpose alters chord
    // widths, toggling chords changes line height, and both change what fits.
  }, [containerRef, contentRef, minFont, maxFont, options.key]);

  return result;
}
