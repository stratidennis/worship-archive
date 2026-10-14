import { describe, expect, it } from 'vitest';
import { shouldResizePerformanceArea } from '../src/lib/useStablePerformanceHeight.js';

describe('performance height stability', () => {
  const tablet = { width: 1000, height: 480, screenWidth: 1000, screenHeight: 600 };

  it('keeps the same song area when tablet browser bars hide or return', () => {
    expect(shouldResizePerformanceArea(tablet, { ...tablet, height: 550 }, true)).toBe(false);
    expect(shouldResizePerformanceArea(tablet, { ...tablet, height: 420 }, true)).toBe(false);
  });

  it('refits when a tablet rotates', () => {
    expect(
      shouldResizePerformanceArea(
        tablet,
        { width: 600, height: 880, screenWidth: 600, screenHeight: 1000 },
        true,
      ),
    ).toBe(true);
  });

  it('continues to refit when a desktop window changes height', () => {
    expect(shouldResizePerformanceArea(tablet, { ...tablet, height: 550 }, false)).toBe(true);
  });
});
