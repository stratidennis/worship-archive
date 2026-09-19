/**
 * Main-process settings.
 *
 * Deliberately not in the library folder: the data folder is itself one of these
 * settings, and a setting that lives inside the thing it points at cannot be changed.
 * Lives in the OS's per-user app folder, which is also where it survives a reinstall.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopSettings {
  /** Stable identity advertised even when the laptop receives a new network address. */
  installationId: string;
  /** Friendly discovery name; editable separately from the operating-system hostname. */
  deviceName: string;
  /** Where the `.chopro` files live. */
  dataDir: string;
  port: number;
  /** Keep the screen awake while the app is running. On by default — see `main.ts`. */
  preventSleep: boolean;
  /** Start with the computer, so the leader's laptop is already hosting. */
  autoStart: boolean;
  /** Restored on the next launch, so a projector window reopens where it was. */
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
}

function defaults(): DesktopSettings {
  return {
    installationId: randomUUID(),
    deviceName: 'Worship Archive',
    dataDir: join(app.getPath('userData'), 'library'),
    port: 7373,
    preventSleep: true,
    autoStart: false,
    window: { width: 1280, height: 860, maximized: false },
  };
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): DesktopSettings {
  const base = defaults();
  try {
    const raw = readFileSync(file(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    return {
      ...base,
      ...parsed,
      window: { ...base.window, ...(parsed.window ?? {}) },
    };
  } catch {
    // Missing or corrupt: start from defaults rather than refusing to launch. Whatever
    // was in there, the app failing to open is the worse outcome.
    return base;
  }
}

export function saveSettings(settings: DesktopSettings): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.warn('could not save settings:', error);
  }
}

/** True when the data folder has never held a library — drives the first-run screen. */
export function isFirstRun(dataDir: string): boolean {
  return !existsSync(join(dataDir, 'songs'));
}
