import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { settleSongLayout, songFontsApplied } from './settleSongLayout.js';
import { androidViewport, ANDROID_VIEWPORT_EVENT } from './androidBand.js';
import { MAX_FITTED_SONG_FONT_SIZE, type Song } from '@worship/core';

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
 * Find the largest size within the user's bounds. At equal sizes, prefer fewer
 * columns, then standard spacing.
 *
 * Trials never use the visible song. Desktop measures an off-screen copy in place;
 * touch browsers get a fresh copy and rendering turns to settle inherited styles.
 */

export interface FitOptions {
  song: Song | null | undefined;
  minFontPx?: number;
  /** Initial size while the available area is being measured. */
  preferredFontPx?: number;
  /** Safety ceiling for automatic fit-to-screen enlargement. */
  maxFittedFontPx?: number;
  /** Identify the song and anything besides the song itself that affects layout. */
  key: string;
  /** A warning beside the reader that disappears whenever the song fits. */
  overflowNotice?: RefObject<HTMLElement | null>;
}

export interface FitResult extends FitChoice {
  /** Stable measured content height used by deterministic multi-column flow. */
  heightPx: number;
  /** Phone behavior is based on the device screen, not transient browser chrome. */
  phone: boolean;
  /** True while measuring, so the caller can avoid showing a flash of wrong sizes. */
  measuring: boolean;
}

const MIN_DEFAULT = 12;
const PREFERRED_DEFAULT = 26;
const STANDARD_COLUMN_GAP = '2.5em';
const COMPACT_COLUMN_GAP = '1.5em';
const COMPACT_SECTION_GAP = '0.5em';
const DESKTOP_MEASUREMENT_BUDGET_MS = 12;
const RECENT_LAYOUT_LIMIT = 16;
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

/** A group can have several visual fragments even with `break-inside: avoid`. */
export function crossesColumnBoundary(
  rects: ArrayLike<Pick<DOMRectReadOnly, 'left' | 'height'>>,
): boolean {
  let firstLeft: number | undefined;
  for (const rect of Array.from(rects)) {
    if (rect.height === 0) continue;
    firstLeft ??= rect.left;
    if (Math.abs(rect.left - firstLeft) > 1) return true;
  }
  return false;
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
    columnGap: fit.compactSpacing ? COMPACT_COLUMN_GAP : STANDARD_COLUMN_GAP,
    ...(fit.compactSpacing ? { '--song-section-gap': COMPACT_SECTION_GAP } : {}),
    height: constrained ? `${fit.heightPx}px` : undefined,
    columnFill: constrained ? 'auto' : undefined,
    display: fit.measuring ? 'none' : undefined,
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
  compactSpacing?: boolean;
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
    compactSpacing: false,
    measuring: false,
  };
}

interface MinimumGroupHeight {
  heightInEm: number;
  rows: number;
}

interface RecentLayout {
  song: Song;
  width: number;
  pixelRatio: number;
  minFont: number;
  maxFont: number;
  fit: FitResult;
}

/**
 * Pack a lower bound: one row per lyric line, no headings or gaps, and up to two
 * pixels per row of rounding slack. A valid layout can never split a linked group.
 */
export function canFitSongRows(
  groups: readonly MinimumGroupHeight[],
  fontPx: number,
  availableHeight: number,
  columns: number,
): boolean {
  const capacity = availableHeight + 1;
  let remaining = capacity;
  let usedColumns = 1;
  for (const group of groups) {
    const height = Math.max(0, group.heightInEm * fontPx - 2 * group.rows);
    if (height > capacity) return false;
    if (height > remaining) {
      if (++usedColumns > columns) return false;
      remaining = capacity;
    }
    remaining -= height;
  }
  return true;
}

/** Check larger sizes first because column fragmentation can make fit non-monotonic. */
export async function chooseFit({
  minFontPx,
  maxFittedFontPx = MAX_FITTED_FONT_DEFAULT,
  columns,
  canFit,
  batchSize = 8,
  overflows,
}: {
  minFontPx: number;
  maxFittedFontPx?: number;
  columns: number[];
  canFit?: (fontPx: number, columns: number) => boolean;
  batchSize?: number;
  overflows: (fontPx: number, columns: number, compactSpacing?: boolean) => Promise<boolean>;
}): Promise<FitChoice> {
  const batch: FitChoice[] = [];
  const measureBatch = async (): Promise<FitChoice | undefined> => {
    const results = await Promise.allSettled(
      batch.map((trial) => overflows(trial.fontPx, trial.columns, trial.compactSpacing)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') throw result.reason;
      if (!result.value) return batch[index];
    }
    batch.length = 0;
    return undefined;
  };
  for (
    let fontPx = Math.max(minFontPx, maxFittedFontPx);
    fontPx >= minFontPx;
    fontPx = Math.max(minFontPx, Math.ceil(fontPx) - 1)
  ) {
    for (const count of columns) {
      if (canFit && !canFit(fontPx, count)) continue;
      for (const compactSpacing of count > 1 ? [false, true] : [false]) {
        batch.push({
          fontPx,
          columns: count,
          fits: true,
          ...(compactSpacing && { compactSpacing }),
        });
        if (batch.length < batchSize) continue;
        const match = await measureBatch();
        if (match) return match;
      }
    }
    if (fontPx === minFontPx) break;
  }
  return (await measureBatch()) ?? { fontPx: minFontPx, columns: 1, fits: false };
}

export function useFitToScreen(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: FitOptions,
): FitResult {
  const minFont = options.minFontPx ?? MIN_DEFAULT;
  const maxFittedFont = Math.max(minFont, options.maxFittedFontPx ?? MAX_FITTED_FONT_DEFAULT);
  const preferredFont = Math.min(
    maxFittedFont,
    Math.max(minFont, options.preferredFontPx ?? PREFERRED_DEFAULT),
  );
  const { key, song, overflowNotice } = options;
  const [result, setResult] = useState<FitResult>({
    fontPx: preferredFont,
    columns: 1,
    heightPx: 0,
    phone: false,
    fits: true,
    measuring: true,
  });
  const frame = useRef<number | null>(null);
  const fittedContent = useRef<{ key: string; song: Song } | null>(null);
  const recentLayouts = useRef(new Map<string, RecentLayout>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!song || !container || !contentRef.current) return;

    const identity = { key, song };
    const layouts = recentLayouts.current;
    const showFit = (fit: FitResult): void => {
      fittedContent.current = identity;
      setResult((previous) =>
        previous.fontPx === fit.fontPx &&
        previous.columns === fit.columns &&
        previous.compactSpacing === fit.compactSpacing &&
        previous.fits === fit.fits &&
        previous.heightPx === fit.heightPx &&
        previous.phone === fit.phone &&
        !previous.measuring
          ? previous
          : fit,
      );
    };

    let disposed = false;
    let running = false;
    let queued = false;
    const activeProbes = new Set<HTMLElement>();
    const clearProbes = (): void => {
      for (const probe of activeProbes) probe.remove();
      activeProbes.clear();
    };
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

    const readSpace = (): { width: number; available: number } => {
      // Measure the space the chart would have after its overflow warning and
      // scrollbars disappear. Otherwise a warning can prevent its own dismissal.
      const box = getComputedStyle(container);
      const { width, height } = container.getBoundingClientRect();
      const px = (value: string): number => parseFloat(value) || 0;
      return {
        width:
          width -
          px(box.paddingLeft) -
          px(box.paddingRight) -
          px(box.borderLeftWidth) -
          px(box.borderRightWidth),
        available:
          height -
          px(box.paddingTop) -
          px(box.paddingBottom) -
          px(box.borderTopWidth) -
          px(box.borderBottomWidth) +
          (overflowNotice?.current?.getBoundingClientRect().height ?? 0),
      };
    };

    const measure = async (): Promise<void> => {
      // The final fitted subtree is remounted with its chosen size. ResizeObserver
      // must read that current subtree, not the detached node from the initial fit.
      const content = contentRef.current;
      if (!content) return;
      const { width, available } = readSpace();
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
        fittedContent.current = identity;
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

      const phoneScreen = isPhoneScreen(screenWidth, screenHeight, touchBrowser);
      const pixelRatio = window.devicePixelRatio;
      const cached = layouts.get(key);
      if (
        cached &&
        cached.song === song &&
        cached.width === width &&
        cached.fit.heightPx === available &&
        cached.pixelRatio === pixelRatio &&
        cached.fit.phone === phoneScreen &&
        cached.minFont === minFont &&
        cached.maxFont === maxFittedFont
      ) {
        layouts.delete(key);
        layouts.set(key, cached);
        showFit(cached.fit);
        return;
      }
      let desktopSliceStarted = performance.now();
      let desktopProbe: HTMLElement | undefined;
      const overflows = async (
        fontPx: number,
        columns: number,
        compactSpacing = false,
      ): Promise<boolean> => {
        if (
          !touchBrowser &&
          performance.now() - desktopSliceStarted >= DESKTOP_MEASUREMENT_BUDGET_MS
        ) {
          if (!(await nextFrame())) throw cancelled;
          desktopSliceStarted = performance.now();
        }
        if (disposed || queued) throw cancelled;
        const probe = desktopProbe ?? (content.cloneNode(true) as HTMLElement);
        if (!desktopProbe) {
          activeProbes.add(probe);
          probe.removeAttribute('id');
          probe.setAttribute('aria-hidden', 'true');
          probe.style.position = 'fixed';
          probe.style.left = '-100000px';
          probe.style.top = '0';
          probe.style.width = `${width}px`;
          probe.style.display = '';
          probe.style.visibility = 'hidden';
          probe.style.pointerEvents = 'none';
          if (!touchBrowser) desktopProbe = probe;
        }
        probe.style.fontSize = `${fontPx}px`;
        probe.style.columnCount = String(columns);
        probe.style.columnGap = compactSpacing ? COMPACT_COLUMN_GAP : STANDARD_COLUMN_GAP;
        probe.style.setProperty(
          '--song-section-gap',
          compactSpacing ? COMPACT_SECTION_GAP : '',
        );
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
        if (!probe.parentNode) container.appendChild(probe);
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
        const overflowing =
          exceedsAvailableSpace(
            { scrollHeight, scrollWidth: probe.scrollWidth, clientWidth: probe.clientWidth },
            available,
          ) ||
          (columns > 1 &&
            Array.from(probe.querySelectorAll('[data-song-column-group]')).some((group) =>
              crossesColumnBoundary(group.getClientRects()),
            ));
        if (touchBrowser) {
          probe.remove();
          activeProbes.delete(probe);
        }
        return overflowing;
      };

      const groupHeights = Array.from(
        content.querySelectorAll('[data-song-column-group]'),
        (group) => {
          const rows = group.querySelectorAll<HTMLElement>('[data-song-line-height]');
          let heightInEm = 0;
          for (const line of rows) heightInEm += Number(line.dataset.songLineHeight);
          return { heightInEm, rows: rows.length };
        },
      );
      const best = await chooseFit({
        minFontPx: minFont,
        maxFittedFontPx: maxFittedFont,
        columns: columnCandidates(width, phoneScreen),
        batchSize: touchBrowser ? 8 : 1,
        canFit: (fontPx, columns) => canFitSongRows(groupHeights, fontPx, available, columns),
        overflows,
      });
      clearProbes();

      if (disposed) throw cancelled;
      const current = readSpace();
      if (current.width !== width || current.available !== available) {
        // A rotation while awaiting layout invalidates every trial in this search.
        // Keep trials hidden and measure again using the new available area.
        queued = true;
        return;
      }

      const fit = { ...best, heightPx: available, phone: phoneScreen, measuring: false };
      layouts.delete(key);
      layouts.set(key, { song, width, pixelRatio, minFont, maxFont: maxFittedFont, fit });
      if (layouts.size > RECENT_LAYOUT_LIMIT) {
        const oldest = layouts.keys().next();
        if (!oldest.done) layouts.delete(oldest.value);
      }
      showFit(fit);
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
            clearProbes();
            if (disposed || error === cancelled) return;
            console.warn('Song fitting failed', String(error));
            fittedContent.current = identity;
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
    let observed = readSpace();
    schedule();
    const observer = new ResizeObserver(() => {
      const next = readSpace();
      // ResizeObserver always sends an initial notification. It must not launch a
      // second search just after the first search has displayed its final result.
      if (next.width === observed.width && next.available === observed.available) return;
      observed = next;
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
      clearProbes();
    };
    // `key` re-runs the fit when layout options change: transpose alters chord
    // widths, toggling chords changes line height, and both change what fits.
  }, [
    containerRef,
    contentRef,
    minFont,
    preferredFont,
    maxFittedFont,
    overflowNotice,
    key,
    song,
  ]);

  const fitted = fittedContent.current;
  return fitted?.key === key && fitted.song === song ? result : { ...result, measuring: true };
}
