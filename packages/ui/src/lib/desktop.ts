/**
 * Talking to the Electron shell, when there is one.
 *
 * Everything here has a browser fallback, and the browser path is the one that gets
 * exercised daily — the desktop app is the same web app in a window. A feature that
 * only works in Electron would split the product in two, so the rule is: the native
 * version is nicer, never the only one.
 */

export interface DesktopState {
  dataDir: string;
  port: number;
  addresses: string[];
  hostname: string;
  preventSleep: boolean;
  autoStart: boolean;
  version: string;
  platform: string;
  firstRun: boolean;
}

export interface PickedFile {
  name: string;
  text: string;
}

interface DesktopApi {
  isDesktop: true;
  state: () => Promise<DesktopState>;
  chooseDataDir: () => Promise<string | null>;
  revealDataDir: () => Promise<void>;
  pickFiles: () => Promise<PickedFile[] | null>;
  saveFile: (name: string, contents: string) => Promise<string | null>;
  openFile: () => Promise<PickedFile | null>;
  setPreventSleep: (on: boolean) => Promise<boolean>;
  setAutoStart: (on: boolean) => Promise<boolean>;
  confirm: (options: { message: string; detail?: string; confirmLabel?: string }) => Promise<boolean>;
}

declare global {
  interface Window {
    worship?: DesktopApi;
  }
}

export function desktop(): DesktopApi | null {
  return typeof window !== 'undefined' && window.worship?.isDesktop ? window.worship : null;
}

export const isDesktop = (): boolean => desktop() !== null;

/**
 * Save a file, natively where possible and as a download otherwise.
 *
 * The browser path revokes its object URL on the next tick rather than immediately:
 * revoking synchronously cancels the download in some browsers, which looks exactly
 * like the button not working.
 */
export async function saveTextFile(name: string, contents: string, type = 'application/json'): Promise<string | null> {
  const native = desktop();
  if (native) return native.saveFile(name, contents);

  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}

/** Ask for files, natively where possible and with a hidden `<input>` otherwise. */
export async function pickTextFiles(accept: string, multiple = true): Promise<PickedFile[]> {
  const native = desktop();
  if (native) return (await native.pickFiles()) ?? [];

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    // Chrome fires no event at all when the dialog is cancelled, so the promise would
    // hang forever without this. `cancel` is supported where it matters and harmless
    // where it is not.
    input.addEventListener('cancel', () => resolve([]));
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      void Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      ).then(resolve);
    });
    input.click();
  });
}

/** A native modal in the desktop app, the browser's own otherwise. */
export async function confirmAction(options: {
  message: string;
  detail?: string;
  confirmLabel?: string;
}): Promise<boolean> {
  const native = desktop();
  if (native) return native.confirm(options);
  return confirm(options.detail ? `${options.message}\n\n${options.detail}` : options.message);
}
