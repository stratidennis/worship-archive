import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Fit a whole song onto one screen.
 *
 * > "A nice thing about the old app is that the whole song is always displayed on one
 * > page, and there is no need to have it displayed on multiple pages."
 *
 * On a fixed stage or laptop display, a musician mid-song must never scroll or lose
 * their place, so font size is an *output* of layout. On a touch phone the caller may
 * instead preserve the chosen size and scroll, because that is both possible and more
 * readable than silently shrinking the text.
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
  /** The separate font floor used on portrait/narrow screens before scrolling. */
  narrowMinFontPx?: number;
  maxFontPx?: number;
  /**
   * On a phone, keep the chosen size and scroll instead of silently shrinking it.
   * Desktop displays keep fitting because they may have no practical scroll input.
   */
  narrowScrollAtPreferredSize?: boolean;
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
/*
 * A width breakpoint describes CSS pixels, not the panel's physical resolution.
 *
 * The 10.4-inch Huawei MatePad has a 1200px-wide panel but exposes about 600 CSS px
 * in portrait. Treating everything below 620px as a phone therefore disabled columns
 * and enabled preferred-size scrolling on a real tablet. Contemporary phones are
 * normally well below 500 CSS px in portrait, so this keeps the phone fallback while
 * allowing compact Android tablets to use the fit-to-screen layout.
 */
export const NARROW_SCREEN_WIDTH = 520;

export function usesPreferredSizeScrolling(width: number, enabled: boolean): boolean {
  return enabled && width < NARROW_SCREEN_WIDTH;
}

export function minimumFontForWidth(
  width: number,
  minFontPx: number,
  narrowMinFontPx = minFontPx,
): number {
  return width < NARROW_SCREEN_WIDTH ? narrowMinFontPx : minFontPx;
}

export function exceedsAvailableSpace(
  dimensions: {
    scrollHeight: number;
    scrollWidth: number;
    clientWidth: number;
  },
  availableHeight: number,
): boolean {
  return (
    dimensions.scrollHeight > availableHeight + 1 ||
    dimensions.scrollWidth > dimensions.clientWidth + 1
  );
}

/** Multi-column songs use a fixed-height flow instead of browser-specific balancing. */
export function usesConstrainedColumnFlow(columns: number): boolean {
  return columns > 1;
}

/**
 * Column counts worth trying at a given width. Columns are useless on a phone.
 *
 * Only ever *more* options, never a forced choice: the search below prefers the fewest
 * columns that still allow the largest type, so a wide screen only splits when splitting
 * is what makes the text bigger.
 */
function columnCandidates(width: number): number[] {
  if (width < NARROW_SCREEN_WIDTH) return [1];
  if (width < 1100) return [1, 2];
  if (width < 1800) return [1, 2, 3];
  return [1, 2, 3, 4];
}

export function useFitToScreen(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: FitOptions = {},
): FitResult {
  const minFont = options.minFontPx ?? MIN_DEFAULT;
  const narrowMinFont = options.narrowMinFontPx ?? minFont;
  const maxFont = options.maxFontPx ?? MAX_DEFAULT;
  const narrowScrollAtPreferredSize = options.narrowScrollAtPreferredSize ?? false;
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
      /*
        The *content* box, not `clientHeight`.

        `clientHeight` includes the container's own padding, so a song was allowed to
        grow into it — the last line of a long song sat flush against the bottom edge of
        the screen with the padding underneath it doing nothing. Subtracting it back out
        is what makes the breathing room actually exist, on every view that fits a song:
        the set preview, the song page, the band view and the stage.
      */
      const box = getComputedStyle(container);
      const available =
        container.clientHeight -
        (parseFloat(box.paddingTop) || 0) -
        (parseFloat(box.paddingBottom) || 0);
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

      const original = {
        fontSize: content.style.fontSize,
        columns: content.style.columnCount,
        height: content.style.height,
        columnFill: content.style.columnFill,
      };
      const effectiveMinFont = minimumFontForWidth(width, minFont, narrowMinFont);

      const overflows = (fontPx: number, columns: number): boolean => {
        content.style.fontSize = `${fontPx}px`;
        content.style.columnCount = String(columns);
        /*
          Do not rely on `column-fill: balance` with an automatically sized element.
          Huawei Browser's mobile Chromium build can leave all content in one column,
          so the fitter concludes that only tiny text fits. A known height plus `auto`
          gives every engine the simpler instruction: fill downward to this height,
          then continue in the next column.
        */
        if (usesConstrainedColumnFlow(columns)) {
          content.style.height = `${available}px`;
          content.style.columnFill = 'auto';
        } else {
          content.style.height = '';
          content.style.columnFill = '';
        }
        /*
          Some mobile Chromium variants flow excess multi-column content sideways
          instead of increasing `scrollHeight`. Looking only at height made those
          browsers report a song as fitting while one or more columns sat outside the
          clipped viewport. Measure both axes against the content's own width: its
          parent has horizontal padding, so comparing with the container width would
          incorrectly grant that padding as usable song space.
        */
        return exceedsAvailableSpace(content, available);
      };

      let best = { fontPx: effectiveMinFont, columns: 1, fits: false };

      if (usesPreferredSizeScrolling(width, narrowScrollAtPreferredSize)) {
        best = { fontPx: maxFont, columns: 1, fits: !overflows(maxFont, 1) };
      } else {
        for (const columns of columnCandidates(width)) {
          if (!overflows(maxFont, columns)) {
            best = { fontPx: maxFont, columns, fits: true };
            break; // Fewer columns is always preferable at the same size.
          }
          // Largest size in [minFont, maxFont] that fits, to the nearest pixel.
          let low = effectiveMinFont;
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
      }

      content.style.fontSize = original.fontSize;
      content.style.columnCount = original.columns;
      content.style.height = original.height;
      content.style.columnFill = original.columnFill;

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
  }, [
    containerRef,
    contentRef,
    minFont,
    narrowMinFont,
    maxFont,
    narrowScrollAtPreferredSize,
    options.key,
  ]);

  return result;
}
