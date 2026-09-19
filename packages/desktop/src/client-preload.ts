import { contextBridge, ipcRenderer } from 'electron';
import type { ClientSettings } from './client-settings.js';

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
};

contextBridge.exposeInMainWorld('worshipClient', api);
