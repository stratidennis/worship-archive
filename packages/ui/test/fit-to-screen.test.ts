import { describe, expect, it } from 'vitest';
import {
  chooseFit,
  columnCandidates,
  exceedsAvailableSpace,
  fittedSongOverflowClass,
  fittedSongStyle,
  failedFit,
  isPhoneScreen,
  NARROW_SCREEN_WIDTH,
  usesConstrainedColumnFlow,
  usesPreferredSizeScrolling,
} from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
  it('never preserves an old font below a newly selected floor after measurement fails', () => {
    expect(
      failedFit(
        {
          fontPx: 26,
          columns: 2,
          heightPx: 700,
          phone: false,
          fits: true,
          measuring: true,
        },
        32,
        40,
      ),
    ).toMatchObject({ fontPx: 32, columns: 1, fits: false, measuring: false });
  });

  it('never preserves an old font above a newly selected ceiling after measurement fails', () => {
    expect(
      failedFit(
        {
          fontPx: 60,
          columns: 2,
          heightPx: 700,
          phone: false,
          fits: true,
          measuring: true,
        },
        12,
        34,
      ),
    ).toMatchObject({ fontPx: 34, columns: 1, fits: false, measuring: false });
  });

  it('treats a compact Android tablet as a fit-to-screen display', () => {
    expect(NARROW_SCREEN_WIDTH).toBeLessThan(600);
    expect(usesPreferredSizeScrolling(600, 960, true)).toBe(false);
    expect(columnCandidates(600, false)).toEqual([1, 2]);
  });

  it('does not mistake a narrow song pane on a laptop for a phone', () => {
    expect(isPhoneScreen(1366, 768)).toBe(false);
  });

  it('recognizes a phone in either orientation', () => {
    expect(isPhoneScreen(390, 844)).toBe(true);
    expect(isPhoneScreen(844, 390)).toBe(true);
  });

  it('does not turn a 600px tablet into a phone when browser chrome reduces the viewport', () => {
    // The fitter receives the stable screen dimensions; a transient 1000x480 viewport
    // is deliberately irrelevant to this decision.
    expect(isPhoneScreen(1200, 2000)).toBe(false);
    expect(isPhoneScreen(600, 1000)).toBe(false);
    expect(isPhoneScreen(1000, 600)).toBe(false);
  });

  it('keeps heavily scaled desktop displays out of the phone layout', () => {
    expect(isPhoneScreen(853, 480, false)).toBe(false);
    expect(usesPreferredSizeScrolling(853, 480, true, false)).toBe(false);
  });
});

describe('one-column-first fitting', () => {
  it('fills the available space in one column before considering more columns', async () => {
    const tried: number[] = [];
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => {
        tried.push(columns);
        return font > (columns === 1 ? 41 : 72);
      },
    });
    expect(result).toEqual({ fontPx: 41, columns: 1, fits: true });
    expect(tried).not.toContain(2);
    expect(tried).not.toContain(3);
  });

  it('still keeps one column when it fits only at the exact minimum', async () => {
    const tried: number[] = [];
    const result = await chooseFit({
      minFontPx: 32,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => {
        tried.push(columns);
        return font > (columns === 1 ? 32 : 72);
      },
    });
    expect(result).toEqual({ fontPx: 32, columns: 1, fits: true });
    expect(tried).not.toContain(2);
    expect(tried).not.toContain(3);
  });

  it('uses the first column count that preserves the minimum, then enlarges within it', async () => {
    const tried: number[] = [];
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => {
        tried.push(columns);
        return font > (columns === 1 ? 11 : columns === 2 ? 34 : 39);
      },
    });
    expect(result).toEqual({ fontPx: 34, columns: 2, fits: true });
    expect(tried).not.toContain(3);
  });

  it('uses fewer columns when they fit at the same largest font', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 11 : 38),
    });
    expect(result).toEqual({ fontPx: 38, columns: 2, fits: true });
  });

  it('uses three columns only when two cannot preserve the minimum', async () => {
    const result = await chooseFit({
      minFontPx: 23,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 22 : columns === 2 ? 22 : 31),
    });
    expect(result).toEqual({ fontPx: 31, columns: 3, fits: true });
  });

  it('never enlarges text beyond the selected maximum', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 28,
      columns: [1, 2, 3],
      overflows: async () => false,
    });
    expect(result).toEqual({ fontPx: 28, columns: 1, fits: true });
  });

  it('reports an honest failure at the minimum when no allowed layout fits', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      columns: [1, 2],
      overflows: async () => true,
    });
    expect(result).toEqual({ fontPx: 12, columns: 1, fits: false });
  });
});

describe('phone font-size control', () => {
  it('uses the chosen size and scrolling on a narrow Band screen', () => {
    expect(usesPreferredSizeScrolling(390, 844, true)).toBe(true);
  });

  it('keeps fitting on desktop screens even when phone scrolling is enabled', () => {
    expect(usesPreferredSizeScrolling(1280, 720, true)).toBe(false);
  });

  it('never offers columns on a phone', () => {
    expect(columnCandidates(390, true)).toEqual([1]);
  });
});

describe('fit overflow measurement', () => {
  it('scrolls an unfitted interactive song on any device but keeps Stage clipped', () => {
    expect(fittedSongOverflowClass(false, true)).toContain('overflow-y-auto');
    expect(fittedSongOverflowClass(false, false)).toContain('overflow-hidden');
    expect(fittedSongOverflowClass(true, true)).toContain('overflow-hidden');
  });

  it('rejects content that a mobile column layout flows beyond the right edge', () => {
    expect(
      exceedsAvailableSpace({ scrollHeight: 560, scrollWidth: 1940, clientWidth: 960 }, 560),
    ).toBe(true);
  });

  it('accepts content only when it stays inside both viewport axes', () => {
    expect(
      exceedsAvailableSpace({ scrollHeight: 560, scrollWidth: 960, clientWidth: 960 }, 560),
    ).toBe(false);
  });

  it('constrains multi-column flow so mobile browsers do not need to balance it', () => {
    expect(usesConstrainedColumnFlow(1)).toBe(false);
    expect(usesConstrainedColumnFlow(2)).toBe(true);
  });

  it('keeps phone content unconstrained but gives larger displays deterministic columns', () => {
    expect(
      fittedSongStyle({
        fontPx: 26,
        columns: 1,
        heightPx: 560,
        phone: true,
        fits: false,
        measuring: false,
      }),
    ).toMatchObject({
      columnCount: 1,
      height: undefined,
      columnFill: undefined,
      visibility: 'visible',
    });
    expect(
      fittedSongStyle({
        fontPx: 20,
        columns: 2,
        heightPx: 560,
        phone: false,
        fits: true,
        measuring: false,
      }),
    ).toMatchObject({
      columnCount: 2,
      height: '560px',
      columnFill: 'auto',
      visibility: 'visible',
    });
  });
});
