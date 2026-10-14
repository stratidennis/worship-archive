/** The Android bridge is deliberately not a desktop bridge: phones still scroll. */
interface AndroidBandBridge {
  openConnectionSettings: () => void;
  /** Actual WebView bounds in Android density-independent (CSS) pixels. */
  getViewport?: () => string;
}

export interface AndroidViewport {
  width: number;
  height: number;
  /** Stable device size, not the temporarily shorter landscape window. */
  shortSide: number;
}

export const ANDROID_VIEWPORT_EVENT = 'worship-android-viewport';

declare global {
  interface Window {
    worshipAndroid?: AndroidBandBridge;
  }
}

export function androidBand(): AndroidBandBridge | null {
  return typeof window === 'undefined' ? null : (window.worshipAndroid ?? null);
}

export function androidViewport(): AndroidViewport | null {
  try {
    const raw = androidBand()?.getViewport?.();
    if (!raw) return null;
    const value = JSON.parse(raw) as AndroidViewport;
    return [value.width, value.height, value.shortSide].every(
      (size) => typeof size === 'number' && Number.isFinite(size) && size > 0,
    )
      ? value
      : null;
  } catch {
    // Older APKs and initial zero-size native layouts retain the browser fallback.
    return null;
  }
}
