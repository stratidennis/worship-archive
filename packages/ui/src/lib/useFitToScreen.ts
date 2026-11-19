import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { settleSongLayout, songFontsApplied } from './settleSongLayout.js';
import { androidViewport, ANDROID_VIEWPORT_EVENT } from './androidBand.js';
import { MAX_FITTED_SONG_FONT_SIZE } from '@worship/core';

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
 * Find the largest size that fits the viewport within the user's bounds. Prefer
 * fewer columns at the same size. If nothing fits at the minimum, the caller can
 * enable scrolling or show a warning while keeping the selected minimum.
 *
 * Each trial uses a fresh off-screen copy, never the visible song. Touch browsers get
 * rendering turns to apply the trial before its dimensions are read.
 */

export interface FitOptions {
  minFontPx?: number;
  /** Initial size while the available area is being measured. */
  preferredFontPx?: number;
  /** Safety ceiling for automatic fit-to-screen enlargement. */
  maxFittedFontPx?: number;
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
/** Large enough to fill a short song without producing display-sized novelty text. */
export const MAX_FITTED_FONT_DEFAULT = MAX_FITTED_SONG_FONT_SIZE;
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
 * Column counts worth trying at a given width. Phones use one column.
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

/** A failed browser measurement must still honour the selected readability floor. */
export function failedFit(
  previous: FitResult,
  minFontPx: number,
  maxFontPx = MAX_FITTED_FONT_DEFAULT,
): FitResult {
  return {
    ...previous,
    fontPx: Math.min(maxFontPx, Math.max(previous.fontPx, minFontPx)),
    columns: 1,
    fits: false,
    measuring: false,
  };
}

/** Search from fewer to more columns and let a wider layout win only at a larger font. */
export async function chooseFit({
  minFontPx,
  maxFittedFontPx = MAX_FITTED_FONT_DEFAULT,
  columns,
  overflows,
}: {
  minFontPx: number;
  maxFittedFontPx?: number;
  columns: number[];
  overflows: (fontPx: number, columns: number) => Promise<boolean>;
}): Promise<FitChoice> {
  const ceiling = Math.max(minFontPx, maxFittedFontPx);
  let best: FitChoice = { fontPx: minFontPx, columns: 1, fits: false };
  for (const columnCount of columns) {
    const floor = best.fits ? best.fontPx + 1 : minFontPx;
    if (floor > ceiling) break;
    // Prove this layout fits at the search floor before trying larger sizes.
    if (await overflows(floor, columnCount)) continue;
    let low = floor + 1;
    let high = ceiling;
    let found = floor;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (await overflows(mid, columnCount)) high = mid - 1;
      else {
        found = mid;
        low = mid + 1;
      }
    }
    best = { fontPx: found, columns: columnCount, fits: true };
  }
  return best;
}

export function useFitToScreen(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: FitOptions = {},
): FitResult {
  const minFont = options.minFontPx ?? MIN_DEFAULT;
  const maxFittedFont = Math.max(minFont, options.maxFittedFontPx ?? MAX_FITTED_FONT_DEFAULT);
  const preferredFont = Math.min(
    maxFittedFont,
    Math.max(minFont, options.preferredFontPx ?? PREFERRED_DEFAULT),
  );
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
        // unmeasured song is far better than a blank screen. Still clamp an older
        // result so changing the ceiling can never leave oversized text behind.
        setResult((previous) => ({
          ...previous,
          fontPx: Math.min(maxFittedFont, Math.max(previous.fontPx, minFont)),
          measuring: false,
        }));
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
        let scrollHeight = probe.scrollHeight;
        if (columns > 1 && scrollHeight > available + 1) {
          // WebKit can include unfragmented flow in scrollHeight even when every
          // section fits in its column. Check where the sections actually landed.
          const sections = probe.querySelectorAll('section');
          if (sections.length > 0) {
            const top = probe.getBoundingClientRect().top;
            scrollHeight = 0;
            for (const section of sections) {
              scrollHeight = Math.max(
                scrollHeight,
                section.getBoundingClientRect().bottom - top,
              );
            }
          }
        }
        const overflowing = exceedsAvailableSpace(
          { scrollHeight, scrollWidth: probe.scrollWidth, clientWidth: probe.clientWidth },
          available,
        );
        probe.remove();
        activeProbe = null;
        return overflowing;
      };

      const best = await chooseFit({
        minFontPx: minFont,
        maxFittedFontPx: maxFittedFont,
        columns: columnCandidates(width, phoneScreen),
        overflows,
      });

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
            // The old layout may belong to the previous setting or song. Keeping its
            // font here allowed a 26px result to survive after the Stage floor moved
            // to 32px whenever a browser rejected one of the new measurement trials.
            // The warning/scroll fallback may remain, but readability is non-negotiable.
            setResult((previous) => failedFit(previous, minFont, maxFittedFont));
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
  }, [containerRef, contentRef, minFont, preferredFont, maxFittedFont, options.key]);

  return fittedKey.current === options.key ? result : { ...result, measuring: true };
}
