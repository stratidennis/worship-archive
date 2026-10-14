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
 *   1. one column at the largest size that fits
 *   2. more columns, if the container is wide enough — two readable columns beat one
 *      column of shrunken text
 *   3. the largest size that fits at the best column count
 *   4. if nothing fits even at the minimum, report `fits: false` so the caller can
 *      offer block mode rather than rendering something illegible
 *
 * Each trial uses a fresh off-screen copy, never the visible song. Touch browsers get
 * rendering turns to apply the trial before its dimensions are read.
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
  /** Stable measured content height used by deterministic multi-column flow. */
  heightPx: number;
  /** Phone behavior is based on the device screen, not transient browser chrome. */
  phone: boolean;
  /** False when the song overflows even at the minimum size — the honest failure. */
  fits: boolean;
  /** True while measuring, so the caller can avoid showing a flash of wrong sizes. */
  measuring: boolean;
}

const MIN_DEFAULT = 11;
const MAX_DEFAULT = 40;
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

export function minimumFontForScreen(
  screenWidth: number,
  screenHeight: number,
  minFontPx: number,
  narrowMinFontPx = minFontPx,
  touchBrowser = true,
): number {
  return isPhoneScreen(screenWidth, screenHeight, touchBrowser) ? narrowMinFontPx : minFontPx;
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

/**
 * Column counts worth trying at a given width. Columns are useless on a phone.
 *
 * Only ever *more* options, never a forced choice: the search below prefers the fewest
 * columns that still allow the largest type, so a wide screen only splits when splitting
 * is what makes the text bigger.
 */
function columnCandidates(width: number, phoneViewport: boolean): number[] {
  if (phoneViewport || width < NARROW_SCREEN_WIDTH) return [1];
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
      const effectiveMinFont = minimumFontForScreen(
        screenWidth,
        screenHeight,
        minFont,
        narrowMinFont,
        touchBrowser,
      );

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
          if (!applied) throw new Error('Browser did not apply the requested song layout');
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

      let best = { fontPx: effectiveMinFont, columns: 1, fits: false };

      if (
        usesPreferredSizeScrolling(
          screenWidth,
          screenHeight,
          narrowScrollAtPreferredSize,
          touchBrowser,
        )
      ) {
        best = { fontPx: maxFont, columns: 1, fits: !(await overflows(maxFont, 1)) };
      } else {
        const candidates = columnCandidates(width, phoneScreen);
        // Try the preferred size in every candidate first: most tablet songs fit in
        // two columns without needing a font-size search at all.
        for (const columns of candidates) {
          if (!(await overflows(maxFont, columns))) {
            best = { fontPx: maxFont, columns, fits: true };
            break; // Fewer columns is always preferable at the same size.
          }
        }
        for (const columns of best.fits ? [] : candidates) {
          // Largest size in [minFont, maxFont] that fits, to the nearest pixel.
          let low = best.fits ? best.fontPx + 1 : effectiveMinFont;
          let high = maxFont;
          let found = 0;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (await overflows(mid, columns)) high = mid - 1;
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
    narrowMinFont,
    maxFont,
    narrowScrollAtPreferredSize,
    options.key,
  ]);

  return fittedKey.current === options.key ? result : { ...result, measuring: true };
}
