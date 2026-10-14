/** The Android bridge is deliberately not a desktop bridge: phones still scroll. */
interface AndroidBandBridge {
  openConnectionSettings: () => void;
}

declare global {
  interface Window {
    worshipAndroid?: AndroidBandBridge;
  }
}

export function androidBand(): AndroidBandBridge | null {
  return typeof window === 'undefined' ? null : (window.worshipAndroid ?? null);
}
