import type { Song } from '@worship/core';
import type { PowerPointReport } from './api.js';

export interface ClientDesktopState {
  installationId: string;
  name: string;
  preferredLeaderId: string | null;
  showChords: boolean;
  autoStart: boolean;
  fullscreen: boolean;
  preventSleep: boolean;
  powerpointsDir: string;
  setupComplete: boolean;
  role: 'band' | 'stage';
  connected: boolean;
}

export type EditableClientSettings = Partial<
  Pick<ClientDesktopState, 'name' | 'showChords' | 'autoStart' | 'fullscreen' | 'preventSleep'>
>;

interface WorshipClientApi {
  completeSetup: (
    patch: Pick<ClientDesktopState, 'name' | 'showChords' | 'autoStart'>,
  ) => Promise<void>;
  state: () => Promise<ClientDesktopState>;
  updateSettings: (patch: EditableClientSettings) => Promise<ClientDesktopState>;
  choosePowerpointsDir: () => Promise<string | null>;
  revealPowerpointsDir: () => Promise<void>;
  findPowerPoints: (songs: Song[]) => Promise<PowerPointReport>;
  createPowerPoints: (songs: Song[]) => Promise<PowerPointReport>;
  openPowerPoints: (paths: string[]) => Promise<string[]>;
  quit: () => Promise<void>;
}

declare global {
  interface Window {
    worshipClient?: WorshipClientApi;
  }
}

export function clientDesktop(): WorshipClientApi | null {
  return window.worshipClient ?? null;
}
