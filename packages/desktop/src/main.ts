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
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  copyLibraryDirectory,
  inspectLibraryDirectory,
  libraryDirectoriesOverlap,
  libraryDirectoryIsEmpty,
  prepareLibraryDirectory,
  resolvePowerPointFile,
  sameLibraryDirectory,
  startServer,
  type LibraryDirectory,
  type RunningServer,
} from '@worship/server';
import { loadSettings, saveSettings, isFirstRun, type DesktopSettings } from './settings.js';
import { openInMicrosoftPowerPoint } from './powerpoint.js';

// `__dirname` is the bundle's own folder: `resources/app/dist` when packaged.
const RESOURCES = __dirname;

// Keep the established data location while the installed product gains the visible
// “Leader” name. A product-name change normally changes Electron's userData folder;
// doing that silently would make an existing song library appear to have vanished.
const legacyUserData = join(app.getPath('appData'), 'Worship Archive');
mkdirSync(legacyUserData, { recursive: true });
app.setPath('userData', legacyUserData);

// Assigned in `bootstrap`, which cannot run before `app.whenReady()` — `loadSettings`
// needs `app.getPath`, which does not exist before then.
let settings!: DesktopSettings;
let server: RunningServer | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let sleepBlocker: number | null = null;
let startupError: Error | null = null;
let serverStart: Promise<boolean> | null = null;

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
    // Not a template image: a template is flattened to a black-or-white silhouette,
    // and the mark is a single brand colour that already reads on a light menu bar and
    // a dark one. Templating it would throw the only thing that identifies it away.
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
  let enabled = false;
  // Linux support here is inconsistent across desktop environments; failing to set it
  // must not take the app down with it.
  try {
    app.setLoginItemSettings({ openAtLogin: on });
    enabled = app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    console.warn('could not change the login item:', error);
  }
  settings.autoStart = enabled;
  saveSettings(settings);
  return enabled;
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

let preparedUi: Promise<void> | null = null;

/** Always render the UI bundled with this installation, never an older PWA cache. */
function loadCurrentUi(target: BrowserWindow, path: string): void {
  if (!server) return;
  preparedUi ??= Promise.all([
    target.webContents.session.clearStorageData({
      origin: server.url,
      storages: ['serviceworkers', 'cachestorage'],
    }),
    target.webContents.session.clearCache(),
  ]).then(() => undefined);

  void preparedUi
    .catch((error: unknown) => console.warn('could not clear the old UI cache:', error))
    .then(() => {
      if (!target.isDestroyed() && server) void target.loadURL(`${server.url}${path}`);
    });
}

function createWindow(path = '/'): BrowserWindow {
  const existing = win && !win.isDestroyed() ? win : null;
  if (existing) {
    if (server) loadCurrentUi(existing, path);
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
  created.once('ready-to-show', () => {
    // The Leader is a workspace, like the Band app: use all available room while
    // remaining a normal window with the operating system's title bar and controls.
    if (!created.isMaximized()) created.maximize();
    created.show();
  });
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
    loadCurrentUi(created, path);
  } else {
    void created.loadURL(failurePage(startupError));
  }

  win = created;
  return created;
}

/**
 * What to show when the server did not start.
 *
 * This page deliberately uses the same blue-neutral palette as the application. It is
 * a recovery state, not a second miniature product with its own amber theme.
 */
function failurePage(error: Error | null): string {
  const detail = error?.message ?? '';
  const escaped = detail.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Worship Archive</title>
<style>
  body{box-sizing:border-box;font:15px/1.6 system-ui,sans-serif;background:#25272a;color:#f0f1f2;margin:0;
       display:grid;place-items:center;height:100vh;padding:24px;text-align:center}
  main{max-width:31rem}
  button{font:inherit;font-weight:650;padding:10px 14px;border:0;border-radius:7px;
         background:#4ea1ef;color:#08131e;cursor:pointer}
  button:disabled{cursor:wait;opacity:.65}
  h1{font-size:22px;margin:0 0 8px}
  p{margin:8px 0 18px;color:#b4b8bd}
  small{display:block;margin-top:14px;color:#8f959b}
  details{margin-top:16px;color:#8f959b;font-size:12px;overflow-wrap:anywhere}
</style>
<main>
  <h1>Worship Archive could not start</h1>
  <p>Its local server did not start. You can try again now.</p>
  <button id="retry" onclick="retryServer()">Try again</button>
  <small id="status">If retrying does not work, close the app and open it again.</small>
  ${escaped ? `<details><summary>Technical details</summary>${escaped}</details>` : ''}
</main>
<script>
  async function retryServer() {
    var button = document.getElementById('retry');
    var status = document.getElementById('status');
    button.disabled = true;
    button.textContent = 'Trying…';
    status.textContent = 'Starting the local server…';
    try {
      var ok = await window.worship.retryServer();
      if (!ok) {
        button.disabled = false;
        button.textContent = 'Try again';
        status.textContent = 'It still could not start. Close the app and open it again.';
      }
    } catch (_) {
      button.disabled = false;
      button.textContent = 'Try again';
      status.textContent = 'It still could not start. Close the app and open it again.';
    }
  }
</script>`;
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
        // Leading is a switch on the current programme, not a destination, so there is
        // no menu entry that takes you to it any more.
        { label: 'Programul curent', accelerator: 'CmdOrCtrl+1', click: go('/') },
        { label: 'Arhiva', accelerator: 'CmdOrCtrl+2', click: go('/archive') },
        { label: 'Programe', accelerator: 'CmdOrCtrl+3', click: go('/sets') },
        { type: 'separator' },
        { label: 'Importă cântări…', accelerator: 'CmdOrCtrl+I', click: go('/import') },
        { label: 'Conectează un dispozitiv…', accelerator: 'CmdOrCtrl+J', click: go('/join') },
        { label: 'Setări', accelerator: 'CmdOrCtrl+,', click: go('/settings') },
        { type: 'separator' },
        {
          label: 'Deschide dosarul arhivei',
          click: (): void => {
            void shell.openPath(settings.dataDir);
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
  ipcMain.handle('worship:retry-server', async () => {
    const started = await startLeaderServer();
    if (started) {
      buildTray();
      if (win && !win.isDestroyed()) loadCurrentUi(win, '/');
    } else if (win && !win.isDestroyed()) {
      void win.loadURL(failurePage(startupError));
    }
    return started;
  });

  ipcMain.handle('worship:state', () => ({
    installationId: settings.installationId,
    deviceName: settings.deviceName,
    dataDir: settings.dataDir,
    songsDir: server?.library.songsDir ?? inspectLibraryDirectory(settings.dataDir).songsDir,
    setsDir: server?.sets.setsDir ?? inspectLibraryDirectory(settings.dataDir).setsDir,
    powerpointsDir: settings.powerpointsDir,
    port: server?.port ?? settings.port,
    addresses: server?.addresses ?? [],
    hostname: server?.hostname ?? '',
    friendlyHostname: server?.friendlyHostname ?? 'worship-archive.local',
    mdns: server?.networkStatus.mdns ?? 'unavailable',
    mdnsError: server?.networkStatus.error ?? null,
    preventSleep: settings.preventSleep,
    autoStart: settings.autoStart,
    version: app.getVersion(),
    platform: process.platform,
    firstRun: isFirstRun(settings.dataDir),
  }));

  ipcMain.handle('worship:choose-data-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Alege dosarul arhivei Worship Archive',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.dataDir,
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return null;

    try {
      if (sameLibraryDirectory(settings.dataDir, chosen)) return settings.dataDir;

      const targetPreview = inspectLibraryDirectory(chosen);
      let source: LibraryDirectory | null = null;
      try {
        source = server
          ? {
              root: settings.dataDir,
              songsDir: server.library.songsDir,
              setsDir: server.sets.setsDir,
            }
          : inspectLibraryDirectory(settings.dataDir);
      } catch {
        // A broken old path must not prevent choosing a healthy replacement.
      }

      if (source && libraryDirectoriesOverlap(source, targetPreview)) {
        throw new Error(
          'Alege un dosar separat, nu unul din interiorul subdosarelor Songs sau Sets actuale.',
        );
      }

      const targetEmpty = libraryDirectoryIsEmpty(targetPreview);
      const sourceHasFiles = source !== null && !libraryDirectoryIsEmpty(source);
      let copyCurrent = false;

      if (targetEmpty && sourceHasFiles) {
        const answer = await dialog.showMessageBox({
          type: 'question',
          title: 'Schimbă dosarul arhivei',
          message: 'Dosarul ales este gol.',
          detail:
            'Poți copia cântările și programele existente în noul dosar sau poți începe cu o arhivă goală. Dosarul vechi rămâne neschimbat ca rezervă.',
          buttons: ['Copiază arhiva actuală', 'Folosește dosarul gol', 'Renunță'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (answer.response === 2) return null;
        copyCurrent = answer.response === 0;
      } else if (!targetEmpty) {
        const answer = await dialog.showMessageBox({
          type: 'question',
          title: 'Schimbă dosarul arhivei',
          message: 'Folosești arhiva din dosarul ales?',
          detail:
            'Worship Archive va citi din subdosarele Songs și Sets existente și va reporni.',
          buttons: ['Folosește acest dosar', 'Renunță'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (answer.response === 1) return null;
      }

      const target = prepareLibraryDirectory(chosen);
      if (copyCurrent && source) copyLibraryDirectory(source, target);

      settings.dataDir = target.root;
      saveSettings(settings);
      // The library and its file watcher are opened once at startup. Give the IPC
      // response a chance to reach the settings page, then restart onto the new root.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 100);
      return target.root;
    } catch (error) {
      dialog.showErrorBox(
        'Dosarul nu poate fi folosit',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  });

  ipcMain.handle('worship:reveal-data-dir', async () => {
    await shell.openPath(settings.dataDir);
  });

  ipcMain.handle('worship:choose-powerpoints-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose the PowerPoints folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.powerpointsDir,
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return null;
    mkdirSync(chosen, { recursive: true });
    settings.powerpointsDir = chosen;
    saveSettings(settings);
    // The HTTP service owns the folder path for this launch. Restart onto the new
    // folder so browser and Band requests see the same setting immediately.
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return chosen;
  });

  ipcMain.handle('worship:reveal-powerpoints-dir', async () => {
    mkdirSync(settings.powerpointsDir, { recursive: true });
    await shell.openPath(settings.powerpointsDir);
  });

  ipcMain.handle('worship:open-powerpoints', async (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return [];
    const files: Array<{ relativePath: string; fullPath: string }> = [];
    for (const candidate of paths) {
      if (typeof candidate !== 'string') continue;
      const full = resolvePowerPointFile(settings.powerpointsDir, candidate);
      if (!full) throw new Error(`PowerPoint file was not found: ${candidate}`);
      files.push({ relativePath: candidate, fullPath: full });
    }
    try {
      await openInMicrosoftPowerPoint(files.map((file) => file.fullPath));
      return [];
    } catch {
      // PowerPoint is preferred, but another registered presentation app is valid.
      const failed: string[] = [];
      for (const file of files) {
        const error = await shell.openPath(file.fullPath);
        if (error) failed.push(file.relativePath);
      }
      return failed;
    }
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
  ipcMain.handle('worship:open-network-settings', async () => {
    const target =
      process.platform === 'win32'
        ? 'ms-settings:network-status'
        : process.platform === 'darwin'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork'
          : 'https://support.microsoft.com/windows/windows-security-firewall-and-network-protection';
    await shell.openExternal(target);
  });
}

// ---- lifecycle -------------------------------------------------------------

async function startLeaderServer(): Promise<boolean> {
  if (server) return true;
  if (serverStart) return serverStart;

  serverStart = (async () => {
    try {
      server = await startServer({
        dataDir: settings.dataDir,
        powerpointsDir: settings.powerpointsDir,
        port: settings.port,
        uiDir: join(RESOURCES, 'ui'),
        leaderId: settings.installationId,
        leaderName: settings.deviceName,
      });
      startupError = null;
      // A moved port is the new truth; the join screen reads it from the server anyway,
      // but persisting it keeps the next launch on the same one.
      settings.port = server.port;
      saveSettings(settings);
      console.log(`Worship Archive on ${server.url} (library: ${settings.dataDir})`);
      return true;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.error('the server did not start:', startupError);
      return false;
    } finally {
      serverStart = null;
    }
  })();

  return serverStart;
}

async function bootstrap(): Promise<void> {
  settings = loadSettings();
  // Re-register the saved choice on every launch. This repairs a login item removed by
  // an installer update or an operating-system cleanup, while getLoginItemSettings
  // makes the checkbox reflect what the OS actually accepted rather than our request.
  setAutoStart(settings.autoStart);
  setPreventSleep(settings.preventSleep);

  await startLeaderServer();

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
