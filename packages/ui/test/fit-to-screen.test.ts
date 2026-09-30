import { describe, expect, it } from 'vitest';
import { minimumFontForWidth } from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
  it('allows a smaller readable size on a narrow phone before requiring scrolling', () => {
    expect(minimumFontForWidth(390, 14, 10)).toBe(10);
  });

  it('keeps the normal minimum on wider screens', () => {
    expect(minimumFontForWidth(768, 14, 10)).toBe(14);
  });

  it('never raises the configured minimum on a narrow screen', () => {
    expect(minimumFontForWidth(390, 11, 14)).toBe(11);
  });
});
