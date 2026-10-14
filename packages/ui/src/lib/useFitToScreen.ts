import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { settleSongLayout, songFontsApplied } from './settleSongLayout.js';
import { androidViewport, ANDROID_VIEWPORT_EVENT } from './androidBand.js';

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
 *   1. one continuous column, shrinking only as far as the chosen minimum
 *   2. only when one column would have to cross that floor, allow more columns
 *   3. within the allowed multi-column alternatives, keep the text as large as possible
 *   4. if nothing fits even at the minimum, report `fits: false` so the caller can
 *      offer block mode rather than rendering something illegible
 *
 * Each trial uses a fresh off-screen copy, never the visible song. Touch browsers get
 * rendering turns to apply the trial before its dimensions are read.
 */

export interface FitOptions {
  minFontPx?: number;
  /** A practical automatic starting size, not a user-facing maximum setting. */
  preferredFontPx?: number;
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
  /** Stable measured content height used by deterministic multi-column flow. */
  heightPx: number;
  /** Phone behavior is based on the device screen, not transient browser chrome. */
  phone: boolean;
  /** False when the song overflows even at the minimum size — the honest failure. */
  fits: boolean;
  /** True while measuring, so the caller can avoid showing a flash of wrong sizes. */
  measuring: boolean;
}

const MIN_DEFAULT = 12;
const PREFERRED_DEFAULT = 26;
/*
 * A screen breakpoint describes CSS pixels, not the panel's physical resolution.
 *
 * The 10.4-inch Huawei MatePad has a 1200px-wide panel but exposes about 600 CSS px
 * on its short side. The visible browser viewport can fall below that when its address
 * and navigation bars are showing, so it is not a stable device signal: scrolling can
 * otherwise turn the same tablet into and out of "phone mode". `screen.width/height`
 * stay stable as browser chrome moves and still identify a phone in either orientation.
 */
export const NARROW_SCREEN_WIDTH = 520;

export function isPhoneScreen(
  screenWidth: number,
  screenHeight: number,
  touchBrowser = true,
): boolean {
  return touchBrowser && Math.min(screenWidth, screenHeight) < NARROW_SCREEN_WIDTH;
}

export function usesPreferredSizeScrolling(
  screenWidth: number,
  screenHeight: number,
  enabled: boolean,
  touchBrowser = true,
): boolean {
  return enabled && isPhoneScreen(screenWidth, screenHeight, touchBrowser);
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

/** The shared final style for every fitted song surface. */
export function fittedSongStyle(fit: FitResult): CSSProperties {
  const constrained = usesConstrainedColumnFlow(fit.columns);
  return {
    fontSize: `${fit.fontPx}px`,
    columnCount: fit.columns,
    columnGap: '2.5em',
    height: constrained ? `${fit.heightPx}px` : undefined,
    columnFill: constrained ? 'auto' : undefined,
    visibility: fit.measuring ? 'hidden' : 'visible',
  };
}

/** Interactive song screens may scroll only after every readable fit has failed. */
export function fittedSongOverflowClass(fits: boolean, allowFallbackScroll: boolean): string {
  return !fits && allowFallbackScroll
    ? 'touch-pan-y overflow-y-auto'
    : 'touch-none overflow-hidden';
}

/**
 * Column counts worth trying at a given width. Columns are useless on a phone.
 *
 * These are only considered after a single column has failed at the selected minimum.
 * Within that fallback, the search keeps the text as large as the available width allows.
 */
export function columnCandidates(width: number, phoneViewport: boolean): number[] {
  if (phoneViewport || width < NARROW_SCREEN_WIDTH) return [1];
  if (width < 1100) return [1, 2];
  if (width < 1800) return [1, 2, 3];
  return [1, 2, 3, 4];
}

export interface FitChoice {
  fontPx: number;
  columns: number;
  fits: boolean;
}

/**
 * Pick a layout without knowing anything about the DOM.
 *
 * Keeping this decision separate from measurement makes its most important promise
 * explicit and testable: no multi-column trial can win while one column still fits at
 * or above the selected minimum.
 */
export async function chooseFit({
  minFontPx,
  preferredFontPx,
  columns,
  overflows,
}: {
  minFontPx: number;
  preferredFontPx: number;
  columns: number[];
  overflows: (fontPx: number, columns: number) => Promise<boolean>;
}): Promise<FitChoice> {
  const largestFit = async (columnCount: number): Promise<number> => {
    let low = minFontPx;
    let high = Math.max(minFontPx, preferredFontPx);
    let found = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (await overflows(mid, columnCount)) high = mid - 1;
      else {
        found = mid;
        low = mid + 1;
      }
    }
    return found;
  };

  const oneColumn = await largestFit(1);
  if (oneColumn > 0) return { fontPx: oneColumn, columns: 1, fits: true };

  let best: FitChoice = { fontPx: minFontPx, columns: 1, fits: false };
  for (const columnCount of columns.filter((candidate) => candidate > 1)) {
    const found = await largestFit(columnCount);
    if (found > best.fontPx || (found === minFontPx && !best.fits)) {
      best = { fontPx: found, columns: columnCount, fits: true };
    }
  }
  return best;
}

export function useFitToScreen(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: FitOptions = {},
): FitResult {
  const minFont = options.minFontPx ?? MIN_DEFAULT;
  const preferredFont = Math.max(minFont, options.preferredFontPx ?? PREFERRED_DEFAULT);
  const narrowScrollAtPreferredSize = options.narrowScrollAtPreferredSize ?? false;
  const [result, setResult] = useState<FitResult>({
    fontPx: preferredFont,
    columns: 1,
    heightPx: 0,
    phone: false,
    fits: true,
    measuring: true,
  });
  const frame = useRef<number | null>(null);
  const fittedKey = useRef<unknown>(Symbol('unmeasured song'));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !contentRef.current) return;

    let disposed = false;
    let running = false;
    let queued = false;
    let activeProbe: HTMLElement | null = null;
    const pendingFrames = new Map<number, (active: boolean) => void>();
    const cancelled = Symbol('cancelled fit');
    const nextFrame = (): Promise<boolean> =>
      new Promise((resolve) => {
        if (disposed) return resolve(false);
        const id = requestAnimationFrame(() => {
          pendingFrames.delete(id);
          resolve(!disposed);
        });
        pendingFrames.set(id, resolve);
      });

    const measure = async (): Promise<void> => {
      // The final fitted subtree is remounted with its chosen size. ResizeObserver
      // must read that current subtree, not the detached node from the initial fit.
      const content = contentRef.current;
      if (!content) return;
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
      // `innerHeight` changes as mobile browser chrome hides and returns. The CSSOM
      // screen size is stable, and is expressed in CSS pixels on browsers and Electron.
      const native = androidViewport();
      // Android's stable smallest-screen dp size does not shrink when landscape
      // bars or a keyboard reduce the WebView's visible height. Tablets stay tablets.
      const screenWidth = native?.shortSide ?? (window.screen?.width || window.innerWidth);
      const screenHeight = native?.shortSide ?? (window.screen?.height || window.innerHeight);
      const touchBrowser =
        native !== null ||
        (!window.worship &&
          !window.worshipClient &&
          window.matchMedia('(pointer: coarse)').matches);
      if (available <= 0 || width <= 0) {
        fittedKey.current = options.key;
        // Nothing to measure against yet (hidden tab, zero-height parent). Show the
        // content at the preferred size rather than leaving it invisible — an
        // unmeasured song is far better than a blank screen.
        setResult((previous) =>
          previous.measuring ? { ...previous, measuring: false } : previous,
        );
        return;
      }

      const contentWidth = content.getBoundingClientRect().width;
      const phoneScreen = isPhoneScreen(screenWidth, screenHeight, touchBrowser);
      const overflows = async (fontPx: number, columns: number): Promise<boolean> => {
        if (disposed) throw cancelled;
        // Inherited em sizes on the actual tablet can remain from several earlier
        // trials. A new subtree starts with the requested font; there are no old
        // inherited styles to invalidate, and no trial ever changes the visible song.
        const probe = content.cloneNode(true) as HTMLElement;
        activeProbe = probe;
        probe.removeAttribute('id');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.position = 'fixed';
        probe.style.left = '-100000px';
        probe.style.top = '0';
        probe.style.width = `${contentWidth}px`;
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        probe.style.fontSize = `${fontPx}px`;
        probe.style.columnCount = String(columns);
        /*
          Do not rely on `column-fill: balance` with an automatically sized element.
          Huawei Browser's mobile Chromium build can leave all content in one column,
          so the fitter concludes that only tiny text fits. A known height plus `auto`
          gives every engine the simpler instruction: fill downward to this height,
          then continue in the next column.
        */
        if (usesConstrainedColumnFlow(columns)) {
          probe.style.height = `${available}px`;
          probe.style.columnFill = 'auto';
        } else {
          probe.style.height = '';
          probe.style.columnFill = '';
        }
        container.appendChild(probe);
        if (touchBrowser) {
          let previousDimensions: string | null = null;
          const applied = await settleSongLayout(() => {
            const style = getComputedStyle(probe);
            const fontsAndColumnsApplied =
              Math.abs(parseFloat(style.fontSize) - fontPx) < 0.01 &&
              Number(style.columnCount) === columns &&
              (!usesConstrainedColumnFlow(columns) ||
                (Math.abs(parseFloat(style.height) - available) < 1 &&
                  style.columnFill === 'auto')) &&
              songFontsApplied(probe, fontPx);
            if (!fontsAndColumnsApplied) {
              previousDimensions = null;
              return false;
            }
            // Column fragmentation can settle after the inherited text styles.
            // Accept only dimensions that remain the same across rendering turns.
            const dimensions = `${probe.scrollWidth}:${probe.scrollHeight}:${probe.clientWidth}`;
            const stable = dimensions === previousDimensions;
            previousDimensions = dimensions;
            return stable;
          }, nextFrame);
          if (disposed) throw cancelled;
          if (!applied) {
            const style = getComputedStyle(probe);
            const mismatches = Array.from(
              probe.querySelectorAll<HTMLElement>('[data-song-font-scale]'),
            )
              .map((text) => ({
                scale: text.dataset.songFontScale,
                actual: getComputedStyle(text).fontSize,
              }))
              .filter(
                (text) =>
                  Math.abs(parseFloat(text.actual) - fontPx * Number(text.scale)) >= 0.05,
              )
              .slice(0, 3);
            throw new Error(
              'Browser did not apply the requested song layout: ' +
                JSON.stringify({
                  native,
                  screenWidth,
                  screenHeight,
                  available,
                  width,
                  fontPx,
                  columns,
                  actualFont: style.fontSize,
                  actualColumns: style.columnCount,
                  actualHeight: style.height,
                  columnFill: style.columnFill,
                  mismatches,
                }),
            );
          }
        }
        /*
          Some mobile Chromium variants flow excess multi-column content sideways
          instead of increasing `scrollHeight`. Looking only at height made those
          browsers report a song as fitting while one or more columns sat outside the
          clipped viewport. Measure both axes against the content's own width: its
          parent has horizontal padding, so comparing with the container width would
          incorrectly grant that padding as usable song space.
        */
        const overflowing = exceedsAvailableSpace(probe, available);
        probe.remove();
        activeProbe = null;
        return overflowing;
      };

      let best: FitChoice = { fontPx: minFont, columns: 1, fits: false };

      if (
        usesPreferredSizeScrolling(
          screenWidth,
          screenHeight,
          narrowScrollAtPreferredSize,
          touchBrowser,
        )
      ) {
        best = {
          fontPx: preferredFont,
          columns: 1,
          fits: !(await overflows(preferredFont, 1)),
        };
      } else {
        const candidates = columnCandidates(width, phoneScreen);
        best = await chooseFit({
          minFontPx: minFont,
          preferredFontPx: preferredFont,
          columns: candidates,
          overflows,
        });
      }

      if (disposed) throw cancelled;
      const currentBox = getComputedStyle(container);
      const currentAvailable =
        container.clientHeight -
        (parseFloat(currentBox.paddingTop) || 0) -
        (parseFloat(currentBox.paddingBottom) || 0);
      if (container.clientWidth !== width || currentAvailable !== available) {
        // A rotation while awaiting layout invalidates every trial in this search.
        // Keep trials hidden and measure again using the new available area.
        queued = true;
        return;
      }

      fittedKey.current = options.key;
      setResult((previous) =>
        previous.fontPx === best.fontPx &&
        previous.columns === best.columns &&
        previous.fits === best.fits &&
        previous.heightPx === available &&
        previous.phone === phoneScreen &&
        !previous.measuring
          ? previous
          : { ...best, heightPx: available, phone: phoneScreen, measuring: false },
      );
    };

    const schedule = (): void => {
      if (disposed) return;
      // Resize/rotation callbacks must not mutate the same node concurrently.
      if (running) {
        queued = true;
        return;
      }
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        running = true;
        void measure()
          .catch((error: unknown) => {
            if (disposed || error === cancelled) return;
            console.warn('Song fitting failed', String(error));
            activeProbe?.remove();
            activeProbe = null;
            fittedKey.current = options.key;
            setResult((previous) => ({ ...previous, fits: false, measuring: false }));
          })
          .finally(() => {
            running = false;
            if (!disposed && queued) {
              queued = false;
              schedule();
            }
          });
      });
    };

    setResult((previous) => (previous.measuring ? previous : { ...previous, measuring: true }));
    let observedWidth = container.clientWidth;
    let observedHeight = container.clientHeight;
    schedule();
    const observer = new ResizeObserver(() => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      // ResizeObserver always sends an initial notification. It must not launch a
      // second search just after the first search has displayed its final result.
      if (nextWidth === observedWidth && nextHeight === observedHeight) return;
      observedWidth = nextWidth;
      observedHeight = nextHeight;
      schedule();
    });
    observer.observe(container);
    const onNativeViewport = (): void => {
      setResult((previous) =>
        previous.measuring ? previous : { ...previous, measuring: true },
      );
      schedule();
    };
    window.addEventListener(ANDROID_VIEWPORT_EVENT, onNativeViewport);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener(ANDROID_VIEWPORT_EVENT, onNativeViewport);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      for (const [id, resolve] of pendingFrames) {
        cancelAnimationFrame(id);
        resolve(false);
      }
      pendingFrames.clear();
      activeProbe?.remove();
      activeProbe = null;
    };
    // `key` re-runs the fit when the content itself changed: transpose alters chord
    // widths, toggling chords changes line height, and both change what fits.
  }, [
    containerRef,
    contentRef,
    minFont,
    preferredFont,
    narrowScrollAtPreferredSize,
    options.key,
  ]);

  return fittedKey.current === options.key ? result : { ...result, measuring: true };
}
