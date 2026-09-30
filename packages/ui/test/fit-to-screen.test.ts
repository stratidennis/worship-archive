import { describe, expect, it } from 'vitest';
import { minimumFontForWidth, usesPreferredSizeScrolling } from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
  it('allows a smaller readable size on a narrow phone before requiring scrolling', () => {
    expect(minimumFontForWidth(390, 14, 10)).toBe(10);
  });

  it('keeps the normal minimum on wider screens', () => {
    expect(minimumFontForWidth(768, 14, 10)).toBe(14);
  });

  it('can keep a more readable floor on phones than on non-scrollable stage displays', () => {
    expect(minimumFontForWidth(390, 8, 12)).toBe(12);
  });
});

describe('phone font-size control', () => {
  it('uses the chosen size and scrolling on a narrow Band screen', () => {
    expect(usesPreferredSizeScrolling(390, true)).toBe(true);
  });

  it('keeps fitting on desktop screens even when phone scrolling is enabled', () => {
    expect(usesPreferredSizeScrolling(1280, true)).toBe(false);
  });
});
