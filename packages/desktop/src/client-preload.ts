import { contextBridge, ipcRenderer } from 'electron';
import type { ClientSettings } from './client-settings.js';
import type { Song } from '@worship/core';
import type { PowerPointReport } from '@worship/server/powerpoints';

const api = {
  completeSetup: (
    patch: Pick<ClientSettings, 'name' | 'showChords' | 'autoStart'>,
  ): Promise<void> => ipcRenderer.invoke('worship-client:complete-setup', patch),
  state: (): Promise<ClientSettings & { role: 'band' | 'stage'; connected: boolean }> =>
    ipcRenderer.invoke('worship-client:state'),
  updateSettings: (
    patch: Partial<
      Pick<ClientSettings, 'name' | 'showChords' | 'autoStart' | 'fullscreen' | 'preventSleep'>
    >,
  ): Promise<ClientSettings> => ipcRenderer.invoke('worship-client:update-settings', patch),
  choosePowerpointsDir: (): Promise<string | null> =>
    ipcRenderer.invoke('worship-client:choose-powerpoints-dir'),
  revealPowerpointsDir: (): Promise<void> =>
    ipcRenderer.invoke('worship-client:reveal-powerpoints-dir'),
  findPowerPoints: (songs: Song[]): Promise<PowerPointReport> =>
    ipcRenderer.invoke('worship-client:find-powerpoints', songs),
  createPowerPoints: (songs: Song[]): Promise<PowerPointReport> =>
    ipcRenderer.invoke('worship-client:create-powerpoints', songs),
  openPowerPoints: (paths: string[]): Promise<string[]> =>
    ipcRenderer.invoke('worship-client:open-powerpoints', paths),
  quit: (): Promise<void> => ipcRenderer.invoke('worship-client:quit'),
};

contextBridge.exposeInMainWorld('worshipClient', api);
