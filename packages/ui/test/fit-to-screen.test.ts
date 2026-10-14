import { describe, expect, it } from 'vitest';
import {
  chooseFit,
  columnCandidates,
  exceedsAvailableSpace,
  fittedSongStyle,
  isPhoneScreen,
  NARROW_SCREEN_WIDTH,
  usesConstrainedColumnFlow,
  usesPreferredSizeScrolling,
} from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
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
  it('keeps one column whenever it fits at or above the selected minimum', async () => {
    const tried: number[] = [];
    const result = await chooseFit({
      minFontPx: 12,
      preferredFontPx: 26,
      columns: [1, 2, 3],
      overflows: async (font, columns) => {
        tried.push(columns);
        return font > (columns === 1 ? 14 : 26);
      },
    });
    expect(result).toEqual({ fontPx: 14, columns: 1, fits: true });
    expect(tried).not.toContain(2);
    expect(tried).not.toContain(3);
  });

  it('allows columns only when one column would cross the minimum', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      preferredFontPx: 26,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 11 : columns === 2 ? 20 : 24),
    });
    expect(result).toEqual({ fontPx: 24, columns: 3, fits: true });
  });

  it('reports an honest failure at the minimum when no allowed layout fits', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      preferredFontPx: 26,
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
