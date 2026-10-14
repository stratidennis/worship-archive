import { afterEach, describe, expect, it, vi } from 'vitest';
import { androidBand } from '../src/lib/androidBand.js';
import { isPhoneScreen, usesPreferredSizeScrolling } from '../src/lib/useFitToScreen.js';
import { shouldResizePerformanceArea } from '../src/lib/useStablePerformanceHeight.js';

afterEach(() => vi.unstubAllGlobals());

describe('Android Band shell', () => {
  it('does not expose native Android settings on desktop or browser clients', () => {
    vi.stubGlobal('window', {});
    expect(androidBand()).toBeNull();
  });

  it('exposes only its connection-settings bridge without pretending to be a desktop', () => {
    const bridge = { openConnectionSettings: vi.fn() };
    vi.stubGlobal('window', { worshipAndroid: bridge });
    expect(androidBand()).toBe(bridge);
    expect(window.worshipClient).toBeUndefined();
    expect(window.worship).toBeUndefined();
    expect(usesPreferredSizeScrolling(390, 844, true, true)).toBe(true);
    expect(isPhoneScreen(800, 1334, true)).toBe(false);
  });

  it('refits real installed-app height changes while browser chrome changes stay stable', () => {
    const initial = { width: 800, height: 1100, screenWidth: 800, screenHeight: 1334 };
    const resized = { ...initial, height: 1000 };
    expect(shouldResizePerformanceArea(initial, resized, false)).toBe(true);
    expect(shouldResizePerformanceArea(initial, resized, true)).toBe(false);
  });
});
