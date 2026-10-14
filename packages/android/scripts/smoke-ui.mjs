import assert from 'node:assert/strict';

export class UiNotReadyError extends Error {}

export function center(node) {
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(bounds, 'UI bounds available');
  return [
    Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
    Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
  ];
}

export function createHierarchyReader(adb) {
  const read = () => {
    try {
      const result = adb('shell', 'uiautomator', 'dump', '/sdcard/worship-band-smoke.xml');
      // A null accessibility root can return success without writing a file. Do
      // not read a nonexistent file, or a stale dump from an earlier screen.
      if (!result.includes('dumped to:')) throw new Error('Android screen is not ready');
      return adb('shell', 'cat', '/sdcard/worship-band-smoke.xml');
    } catch (cause) {
      throw new UiNotReadyError('Android screen is not ready', { cause });
    }
  };
  return () => {
    let xml = read();
    const tutorial = xml.match(/<node\b[^>]*resource-id="com.android.systemui:id\/ok"[^>]*>/);
    if (tutorial && xml.includes('immersive_cling')) {
      adb('shell', 'input', 'tap', ...center(tutorial[0]).map(String));
      xml = read();
    }
    return xml;
  };
}

export async function waitFor(read, label, options = {}) {
  const attempts = options.attempts ?? 60;
  const pause = options.pause ?? (() => new Promise((resolve) => setTimeout(resolve, 1000)));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = read();
      if (result) return result;
    } catch (error) {
      if (!(error instanceof UiNotReadyError)) throw error;
      lastError = error;
    }
    await pause();
  }
  throw new Error(`Timed out: ${label}`, { cause: lastError });
}

export function nativeInputs(xml) {
  return xml.match(/<node\b[^>]*class="android.widget.EditText"[^>]*>/g) ?? [];
}

export async function focusInput(hierarchy, tap, index, options = {}) {
  return waitFor(
    () => {
      const input = nativeInputs(hierarchy())[index];
      if (!input) return null;
      if (input.includes('focused="true"')) return input;
      // Re-read coordinates on every attempt: Android can reposition the dialog
      // after fullscreen confirmation or opening its on-screen keyboard.
      tap(input);
      return null;
    },
    `native input ${index} focused`,
    options,
  );
}
