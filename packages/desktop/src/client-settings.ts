import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ClientRole = 'band' | 'stage';

export interface ClientSettings {
  installationId: string;
  name: string;
  preferredLeaderId: string | null;
  showChords: boolean;
  autoStart: boolean;
  fullscreen: boolean;
  preventSleep: boolean;
  /** Local presentations for this installation. Never shared with the Leader. */
  powerpointsDir: string;
  setupComplete: boolean;
}

function defaults(role: ClientRole): ClientSettings {
  return {
    installationId: randomUUID(),
    name: '',
    preferredLeaderId: null,
    showChords: role === 'band',
    autoStart: role === 'stage',
    fullscreen: role === 'stage',
    preventSleep: role === 'stage',
    powerpointsDir: join(
      app.getPath('documents'),
      role === 'band'
        ? 'Worship Archive Band PowerPoints'
        : 'Worship Archive Stage PowerPoints',
    ),
    setupComplete: false,
  };
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'client-settings.json');
}

export function loadClientSettings(role: ClientRole): ClientSettings {
  const base = defaults(role);
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<ClientSettings>;
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

export function saveClientSettings(settings: ClientSettings): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
}
