import { describe, expect, it } from 'vitest';
import {
  exceedsAvailableSpace,
  fittedSongStyle,
  isPhoneScreen,
  minimumFontForScreen,
  NARROW_SCREEN_WIDTH,
  usesConstrainedColumnFlow,
  usesPreferredSizeScrolling,
} from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
  it('allows a smaller readable size on a narrow phone before requiring scrolling', () => {
    expect(minimumFontForScreen(390, 844, 14, 10)).toBe(10);
  });

  it('keeps the normal minimum on wider screens', () => {
    expect(minimumFontForScreen(1366, 768, 14, 10)).toBe(14);
  });

  it('treats a compact Android tablet as a fit-to-screen display', () => {
    expect(NARROW_SCREEN_WIDTH).toBeLessThan(600);
    expect(minimumFontForScreen(600, 960, 8, 12)).toBe(8);
    expect(usesPreferredSizeScrolling(600, 960, true)).toBe(false);
  });

  it('can keep a more readable floor on phones than on non-scrollable stage displays', () => {
    expect(minimumFontForScreen(390, 844, 8, 12)).toBe(12);
  });

  it('does not mistake a narrow song pane on a laptop for a phone', () => {
    expect(isPhoneScreen(1366, 768)).toBe(false);
    expect(minimumFontForScreen(1366, 768, 8, 12)).toBe(8);
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
    expect(minimumFontForScreen(853, 480, 8, 12, false)).toBe(8);
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
    expect(minimumFontForScreen(1280, 720, 8, 10)).toBe(8);
    expect(minimumFontForScreen(390, 844, 8, 10)).toBe(10);
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
