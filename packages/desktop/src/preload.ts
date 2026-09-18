/**
 * The bridge, and the whole of it.
 *
 * Everything here is something a browser cannot do. Nothing here is a shortcut to the
 * library or the database — those go over HTTP, exactly as they do from a phone, so
 * that the desktop build cannot quietly become a different application.
 *
 * `contextIsolation` is on, so the renderer sees only these functions and never the
 * `ipcRenderer` they are built from.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopState {
  dataDir: string;
  port: number;
  addresses: string[];
  hostname: string;
  preventSleep: boolean;
  autoStart: boolean;
  version: string;
  platform: NodeJS.Platform;
  /** The data folder has never held a library — show the first-run screen. */
  firstRun: boolean;
}

export interface PickedFile {
  name: string;
  text: string;
}

const api = {
  /** The renderer's one reliable "am I in the desktop app?" check. */
  isDesktop: true as const,

  state: (): Promise<DesktopState> => ipcRenderer.invoke('worship:state'),

  /** Returns the chosen folder; the app restarts immediately afterwards. */
  chooseDataDir: (): Promise<string | null> => ipcRenderer.invoke('worship:choose-data-dir'),
  revealDataDir: (): Promise<void> => ipcRenderer.invoke('worship:reveal-data-dir'),

  pickFiles: (): Promise<PickedFile[] | null> => ipcRenderer.invoke('worship:pick-files'),
  saveFile: (name: string, contents: string): Promise<string | null> =>
    ipcRenderer.invoke('worship:save-file', name, contents),
  openFile: (): Promise<PickedFile | null> => ipcRenderer.invoke('worship:open-file'),

  setPreventSleep: (on: boolean): Promise<boolean> =>
    ipcRenderer.invoke('worship:set-prevent-sleep', on),
  setAutoStart: (on: boolean): Promise<boolean> =>
    ipcRenderer.invoke('worship:set-auto-start', on),

  /** A native modal, for the handful of decisions that must not be a page element. */
  confirm: (options: {
    message: string;
    detail?: string;
    confirmLabel?: string;
  }): Promise<boolean> => ipcRenderer.invoke('worship:confirm', options),
};

export type WorshipDesktopApi = typeof api;

contextBridge.exposeInMainWorld('worship', api);
