export interface ClientDesktopState {
  installationId: string;
  name: string;
  preferredLeaderId: string | null;
  showChords: boolean;
  autoStart: boolean;
  fullscreen: boolean;
  preventSleep: boolean;
  setupComplete: boolean;
  role: 'band' | 'stage';
  connected: boolean;
}

export type EditableClientSettings = Partial<
  Pick<ClientDesktopState, 'name' | 'showChords' | 'autoStart' | 'fullscreen' | 'preventSleep'>
>;

interface WorshipClientApi {
  state: () => Promise<ClientDesktopState>;
  updateSettings: (patch: EditableClientSettings) => Promise<ClientDesktopState>;
}

declare global {
  interface Window {
    worshipClient?: WorshipClientApi;
  }
}

export function clientDesktop(): WorshipClientApi | null {
  return window.worshipClient ?? null;
}
