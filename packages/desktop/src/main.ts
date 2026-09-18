/**
 * The Electron main process.
 *
 * This process *is* the host. It runs Fastify, the WebSocket hub, SQLite and the mDNS
 * advertisement, and then opens a window pointed at `http://localhost:<port>` — the
 * same URL a phone on the WiFi uses. The renderer has no privileged path to the
 * filesystem or the database, and that is on purpose: the desktop build and the browser
 * build are then the same application, and a bug can never exist in only one of them.
 *
 * IPC exists for exactly the things a browser genuinely cannot do — a native file
 * picker, choosing where the library lives, quitting. Everything else goes over HTTP.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { startServer, type RunningServer } from '@worship/server';
import { loadSettings, saveSettings, isFirstRun, type DesktopSettings } from './settings.js';

// `__dirname` is the bundle's own folder: `resources/app/dist` when packaged.
const RESOURCES = __dirname;

// Assigned in `bootstrap`, which cannot run before `app.whenReady()` — `loadSettings`
// needs `app.getPath`, which does not exist before then.
let settings!: DesktopSettings;
let server: RunningServer | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let sleepBlocker: number | null = null;
let startupError: Error | null = null;

/**
 * A second launch must not start a second server.
 *
 * Without this the second instance fails to bind, silently moves to port 7375, and the
 * band's QR code from ten minutes ago now points at the wrong one.
 */
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  // `app.quit()` is a request, not a return: without the guard below, this instance
  // would keep going and try to bind a port and open the library before the quit
  // lands. Two servers over one SQLite file, briefly, is not a race worth having.
  app.quit();
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(join(RESOURCES, 'build', 'tray-32.png'));
  if (process.platform === 'darwin') {
    const small = nativeImage.createFromPath(join(RESOURCES, 'build', 'tray-16.png'));
    // A macOS menu-bar icon must be a template image or it looks wrong in dark mode.
    small.setTemplateImage(false);
    return small.isEmpty() ? image : small;
  }
  return image;
}

function setPreventSleep(on: boolean): boolean {
  if (on && sleepBlocker === null) {
    // `prevent-display-sleep`, not `prevent-app-suspension`: the screen going dark
    // mid-song is the actual failure, and it is what a musician notices.
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!on && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
  settings.preventSleep = on;
  saveSettings(settings);
  return on;
}

function setAutoStart(on: boolean): boolean {
  // Linux support here is inconsistent across desktop environments; failing to set it
  // must not take the app down with it.
  try {
    app.setLoginItemSettings({ openAtLogin: on });
  } catch (error) {
    console.warn('could not change the login item:', error);
  }
  settings.autoStart = on;
  saveSettings(settings);
  return on;
}

function rememberWindow(): void {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const bounds = win.getNormalBounds();
  settings.window = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized,
  };
  saveSettings(settings);
}

function createWindow(path = '/'): BrowserWindow {
  const existing = win && !win.isDestroyed() ? win : null;
  if (existing) {
    if (server) void existing.loadURL(`${server.url}${path}`);
    existing.show();
    existing.focus();
    return existing;
  }

  const created = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    ...(settings.window.x !== undefined && settings.window.y !== undefined
      ? { x: settings.window.x, y: settings.window.y }
      : {}),
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#16181a',
    title: 'Worship Archive',
    icon: join(RESOURCES, 'build', 'icon.png'),
    // The window is empty until the server answers; showing it before then flashes white.
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(RESOURCES, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (settings.window.maximized) created.maximize();
  created.once('ready-to-show', () => created.show());
  created.on('close', rememberWindow);
  created.on('closed', () => {
    win = null;
  });

  // A link to anywhere else opens in the real browser rather than trapping the user in
  // a window with no address bar.
  created.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (server) {
    void created.loadURL(`${server.url}${path}`);
  } else {
    void created.loadURL(failurePage(startupError));
  }

  win = created;
  return created;
}

/**
 * What to show when the server did not start.
 *
 * A packaged app that opens a blank window tells the user nothing. This at least names
 * the error and the folder, which is enough to ask for help with.
 */
function failurePage(error: Error | null): string {
  const message = error ? error.message : 'Serverul nu a pornit.';
  const dataDir = settings?.dataDir ?? '';
  const html = `<!doctype html><html lang="ro"><meta charset="utf-8">
<title>Worship Archive</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;background:#16181a;color:#e8eaed;margin:0;
       display:grid;place-items:center;height:100vh;padding:24px;text-align:center}
  code{background:#26292c;padding:2px 6px;border-radius:4px;font-size:13px}
  h1{font-size:20px;margin:0 0 8px}
  p{max-width:46ch;color:#a9b0b6}
</style>
<h1>Worship Archive nu a putut porni</h1>
<p>${message.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</p>
<p>Dosarul cu cântări: <code>${dataDir.replace(/[<&]/g, '')}</code></p>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function joinText(): string {
  if (!server) return 'Serverul nu rulează';
  const lines = server.addresses.map((a) => `http://${a}:${server!.port}`);
  return lines.length > 0 ? lines.join('\n') : 'Nicio rețea — nimeni nu se poate conecta';
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const go = (path: string) => (): void => {
    createWindow(path);
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Fișier',
      submenu: [
        { label: 'Bibliotecă', accelerator: 'CmdOrCtrl+1', click: go('/') },
        { label: 'Programe', accelerator: 'CmdOrCtrl+2', click: go('/sets') },
        { label: 'Condu serviciul', accelerator: 'CmdOrCtrl+3', click: go('/lead') },
        { type: 'separator' },
        { label: 'Importă cântări…', accelerator: 'CmdOrCtrl+I', click: go('/import') },
        { label: 'Conectează un dispozitiv…', accelerator: 'CmdOrCtrl+J', click: go('/join') },
        { label: 'Setări', accelerator: 'CmdOrCtrl+,', click: go('/settings') },
        { type: 'separator' },
        {
          label: 'Deschide dosarul cu cântări',
          click: (): void => {
            void shell.openPath(join(settings.dataDir, 'songs'));
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Editare',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Vizualizare',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Ajutor',
      submenu: [
        {
          label: 'Cum se conectează trupa',
          click: (): void => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Conectează un dispozitiv',
              message: 'Deschide una dintre aceste adrese pe telefon sau tabletă:',
              detail: `${joinText()}\n\nToate dispozitivele trebuie să fie pe același WiFi. Nu e nevoie de internet.`,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray(): void {
  if (tray) tray.destroy();
  tray = new Tray(trayImage());
  tray.setToolTip('Worship Archive');

  const refresh = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: server ? `Rulează pe portul ${server.port}` : 'Serverul nu rulează',
          enabled: false,
        },
        { type: 'separator' },
        { label: 'Deschide fereastra', click: (): void => void createWindow() },
        { label: 'Condu serviciul', click: (): void => void createWindow('/lead') },
        { label: 'Conectează un dispozitiv…', click: (): void => void createWindow('/join') },
        { type: 'separator' },
        {
          label: 'Ține ecranul aprins',
          type: 'checkbox',
          checked: settings.preventSleep,
          click: (item): void => {
            setPreventSleep(item.checked);
            refresh();
          },
        },
        {
          label: 'Pornește odată cu calculatorul',
          type: 'checkbox',
          checked: settings.autoStart,
          click: (item): void => {
            setAutoStart(item.checked);
            refresh();
          },
        },
        { type: 'separator' },
        { label: 'Ieși', click: (): void => void app.quit() },
      ]),
    );
  };

  refresh();
  tray.on('click', () => createWindow());
}

// ---- IPC: only what a browser genuinely cannot do --------------------------

function registerIpc(): void {
  ipcMain.handle('worship:state', () => ({
    dataDir: settings.dataDir,
    port: server?.port ?? settings.port,
    addresses: server?.addresses ?? [],
    hostname: server?.hostname ?? '',
    preventSleep: settings.preventSleep,
    autoStart: settings.autoStart,
    version: app.getVersion(),
    platform: process.platform,
    firstRun: isFirstRun(settings.dataDir),
  }));

  ipcMain.handle('worship:choose-data-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Alege dosarul pentru cântări',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.dataDir,
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return null;

    settings.dataDir = chosen;
    saveSettings(settings);
    // The library is opened once at startup; pointing it somewhere else means starting
    // over. Restarting is honest about that, and takes two seconds.
    app.relaunch();
    app.exit(0);
    return chosen;
  });

  ipcMain.handle('worship:reveal-data-dir', async () => {
    await shell.openPath(join(settings.dataDir, 'songs'));
  });

  /** A native picker for files to import. Returns their text, not their paths. */
  ipcMain.handle('worship:pick-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Alege fișiere de importat',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Cântări',
          extensions: ['chopro', 'cho', 'chordpro', 'pro', 'song', 'xml', 'txt'],
        },
        { name: 'Toate fișierele', extensions: ['*'] },
      ],
    });
    if (result.canceled) return null;
    return Promise.all(
      result.filePaths.map(async (path) => ({
        name: basename(path),
        text: await readFile(path, 'utf8'),
      })),
    );
  });

  ipcMain.handle('worship:save-file', async (_event, name: string, contents: string) => {
    const result = await dialog.showSaveDialog({ title: 'Salvează', defaultPath: name });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, contents, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('worship:open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Alege o copie de siguranță',
      properties: ['openFile'],
      filters: [{ name: 'Copie de siguranță', extensions: ['json'] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { name: basename(path), text: await readFile(path, 'utf8') };
  });

  ipcMain.handle('worship:set-prevent-sleep', (_event, on: boolean) =>
    setPreventSleep(Boolean(on)),
  );
  ipcMain.handle('worship:set-auto-start', (_event, on: boolean) => setAutoStart(Boolean(on)));

  ipcMain.handle(
    'worship:confirm',
    async (_event, options: { message: string; detail?: string; confirmLabel?: string }) => {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: [options.confirmLabel ?? 'Continuă', 'Anulează'],
        defaultId: 1,
        cancelId: 1,
        message: options.message,
        ...(options.detail ? { detail: options.detail } : {}),
      });
      return result.response === 0;
    },
  );
}

// ---- lifecycle -------------------------------------------------------------

async function bootstrap(): Promise<void> {
  settings = loadSettings();
  setPreventSleep(settings.preventSleep);

  try {
    server = await startServer({
      dataDir: settings.dataDir,
      port: settings.port,
      uiDir: join(RESOURCES, 'ui'),
    });
    // A moved port is the new truth; the join screen reads it from the server anyway,
    // but persisting it keeps the next launch on the same one.
    settings.port = server.port;
    saveSettings(settings);
    console.log(`Worship Archive on ${server.url} (library: ${settings.dataDir})`);
  } catch (error) {
    startupError = error instanceof Error ? error : new Error(String(error));
    console.error('the server did not start:', startupError);
  }

  registerIpc();
  buildMenu();
  buildTray();
  createWindow();
}

if (isPrimaryInstance) void app.whenReady().then(bootstrap);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/**
 * Closing the window does not stop the service.
 *
 * On every platform: band devices are connected to this process, and closing a window
 * during a service must not disconnect them. The tray icon is how you get the window
 * back, and Quit is how you actually stop.
 */
app.on('window-all-closed', () => {
  // Intentionally empty — see above.
});

app.on('before-quit', () => {
  rememberWindow();
});

app.on('will-quit', (event) => {
  if (!server) return;
  event.preventDefault();
  const stopping = server;
  server = null;
  void stopping.stop().finally(() => app.quit());
});
