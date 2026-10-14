import { describe, expect, it } from 'vitest';
import {
  exceedsAvailableSpace,
  fittedSongStyle,
  isPhoneViewport,
  minimumFontForViewport,
  NARROW_SCREEN_WIDTH,
  usesConstrainedColumnFlow,
  usesPreferredSizeScrolling,
} from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
  it('allows a smaller readable size on a narrow phone before requiring scrolling', () => {
    expect(minimumFontForViewport(390, 844, 14, 10)).toBe(10);
  });

  it('keeps the normal minimum on wider screens', () => {
    expect(minimumFontForViewport(1366, 768, 14, 10)).toBe(14);
  });

  it('treats a compact Android tablet as a fit-to-screen display', () => {
    expect(NARROW_SCREEN_WIDTH).toBeLessThan(600);
    expect(minimumFontForViewport(600, 960, 8, 12)).toBe(8);
    expect(usesPreferredSizeScrolling(600, 960, true)).toBe(false);
  });

  it('can keep a more readable floor on phones than on non-scrollable stage displays', () => {
    expect(minimumFontForViewport(390, 844, 8, 12)).toBe(12);
  });

  it('does not mistake a narrow song pane on a laptop for a phone', () => {
    expect(isPhoneViewport(1366, 768)).toBe(false);
    expect(minimumFontForViewport(1366, 768, 8, 12)).toBe(8);
  });

  it('recognizes a phone in either orientation', () => {
    expect(isPhoneViewport(390, 844)).toBe(true);
    expect(isPhoneViewport(844, 390)).toBe(true);
  });
});

describe('phone font-size control', () => {
  it('uses the chosen size and scrolling on a narrow Band screen', () => {
    expect(usesPreferredSizeScrolling(390, 844, true)).toBe(true);
  });

  it('keeps fitting on desktop screens even when phone scrolling is enabled', () => {
    expect(usesPreferredSizeScrolling(1280, 720, true)).toBe(false);
  });

  it('keeps the desktop Band floor separate from its phone floor', () => {
    expect(minimumFontForViewport(1280, 720, 8, 10)).toBe(8);
    expect(minimumFontForViewport(390, 844, 8, 10)).toBe(10);
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
      fittedSongStyle({ fontPx: 26, columns: 1, fits: false, measuring: false }),
    ).toMatchObject({
      columnCount: 1,
      height: undefined,
      columnFill: undefined,
      visibility: 'visible',
    });
    expect(
      fittedSongStyle({ fontPx: 20, columns: 2, fits: true, measuring: false }),
    ).toMatchObject({
      columnCount: 2,
      height: '100%',
      columnFill: 'auto',
      visibility: 'visible',
    });
  });
});
