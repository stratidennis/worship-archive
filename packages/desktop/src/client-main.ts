/**
 * Electron shell shared by the Band and Stage products.
 *
 * It serves the packaged UI on loopback immediately, even when no Leader exists. API
 * and WebSocket traffic is proxied to whichever compatible Leader mDNS discovers. The
 * renderer therefore has one stable local origin and its existing reconnect loop does
 * not care when the Leader starts, stops, or receives a new IP address.
 */

import { app, BrowserWindow, ipcMain, powerSaveBlocker, shell } from 'electron';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import Bonjour, { type Browser, type Service } from 'bonjour-service';
import WebSocket, { WebSocketServer } from 'ws';
import { SESSION_PROTOCOL_VERSION } from '@worship/core';
import {
  loadClientSettings,
  saveClientSettings,
  type ClientRole,
  type ClientSettings,
} from './client-settings.js';

declare const __WORSHIP_DESKTOP_ROLE__: ClientRole;
declare const __WORSHIP_PRODUCT_NAME__: string;

const ROLE = __WORSHIP_DESKTOP_ROLE__;
const PRODUCT_NAME = __WORSHIP_PRODUCT_NAME__;
const RESOURCES = __dirname;
const UI_DIR = resolve(RESOURCES, 'ui');

interface LeaderEndpoint {
  id: string;
  name: string;
  host: string;
  port: number;
}

let settings!: ClientSettings;
let win: BrowserWindow | null = null;
let shellServer: Server | null = null;
let shellUrl = '';
let discovery: Bonjour | null = null;
let browser: Browser | null = null;
let leader: LeaderEndpoint | null = null;
let sleepBlocker: number | null = null;
const leaders = new Map<string, LeaderEndpoint>();

app.setName(PRODUCT_NAME);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

function serviceEndpoint(service: Service): LeaderEndpoint | null {
  const txt = (service.txt ?? {}) as Record<string, unknown>;
  if (txt['app'] !== 'worship-archive' || txt['role'] !== 'leader') return null;
  if (Number(txt['protocol']) !== SESSION_PROTOCOL_VERSION) return null;
  const id = typeof txt['leaderId'] === 'string' ? txt['leaderId'] : '';
  const host =
    service.addresses?.find((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) ??
    service.host;
  if (!id || !host || !service.port) return null;
  return { id, name: service.name, host, port: service.port };
}

function selectLeader(): void {
  const preferred = settings.preferredLeaderId
    ? leaders.get(settings.preferredLeaderId)
    : undefined;
  leader =
    preferred ?? (leaders.size === 1 ? leaders.values().next().value : undefined) ?? null;
}

function startDiscovery(): void {
  discovery = new Bonjour(undefined, (error: unknown) => {
    console.warn('local discovery error:', error);
  });
  browser = discovery.find({ type: 'http' });
  browser.on('up', (service) => {
    const endpoint = serviceEndpoint(service);
    if (!endpoint) return;
    leaders.set(endpoint.id, endpoint);
    selectLeader();
  });
  browser.on('down', (service) => {
    const endpoint = serviceEndpoint(service);
    if (!endpoint) return;
    leaders.delete(endpoint.id);
    if (leader?.id === endpoint.id) leader = null;
    selectLeader();
  });
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function proxyHttp(request: IncomingMessage, response: ServerResponse): void {
  if (!leader) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"error":"waiting for leader"}');
    return;
  }
  const upstream = httpRequest(
    {
      hostname: leader.host,
      port: leader.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `${leader.host}:${leader.port}` },
    },
    (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
    response.end('{"error":"leader unavailable"}');
  });
  request.pipe(upstream);
}

function serveUi(request: IncomingMessage, response: ServerResponse): void {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const requested = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  let file = resolve(UI_DIR, requested);
  const withinUi = relative(UI_DIR, file);
  if (
    withinUi.startsWith('..') ||
    isAbsolute(withinUi) ||
    !existsSync(file) ||
    statSync(file).isDirectory()
  ) {
    file = join(UI_DIR, 'index.html');
  }
  try {
    response.writeHead(200, { 'content-type': contentType(file) });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('The packaged interface could not be loaded.');
  }
}

async function startShellServer(): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });
  shellServer = createServer((request, response) => {
    if ((request.url ?? '').startsWith('/api/')) proxyHttp(request, response);
    else serveUi(request, response);
  });

  shellServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws' || !leader) {
      socket.destroy();
      return;
    }
    const endpoint = leader;
    wss.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(`ws://${endpoint.host}:${endpoint.port}/ws`);
      const queued: WebSocket.RawData[] = [];

      client.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else if (upstream.readyState === WebSocket.CONNECTING) queued.push(data);
      });
      upstream.on('open', () => {
        for (const data of queued) upstream.send(data);
        queued.length = 0;
      });
      upstream.on('message', (data) => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
      });
      upstream.on('close', () => client.close());
      upstream.on('error', () => client.close());
      client.on('close', () => upstream.close());
      client.on('error', () => upstream.close());
    });
  });

  const preferredPort = ROLE === 'band' ? 7381 : 7382;
  await new Promise<void>((resolveListen, reject) => {
    let port = preferredPort;
    const tryListen = (): void => {
      const onError = (error: NodeJS.ErrnoException): void => {
        shellServer!.off('listening', onListening);
        if (error.code === 'EADDRINUSE' && port < preferredPort + 10) {
          port += 1;
          tryListen();
        } else {
          reject(error);
        }
      };
      const onListening = (): void => {
        shellServer!.off('error', onError);
        resolveListen();
      };
      shellServer!.once('error', onError);
      shellServer!.once('listening', onListening);
      shellServer!.listen(port, '127.0.0.1');
    };
    tryListen();
  });
  const address = shellServer.address();
  if (!address || typeof address === 'string') throw new Error('local interface did not start');
  shellUrl = `http://127.0.0.1:${address.port}`;
}

function clientRoute(): string {
  const params = new URLSearchParams({
    name: settings.name,
    device: settings.installationId,
  });
  if (ROLE === 'stage') params.set('chords', settings.showChords ? '1' : '0');
  return `/${ROLE}?${params.toString()}`;
}

function setupPage(): string {
  const stageOptions =
    ROLE === 'stage'
      ? `<label><input id="chords" type="checkbox" checked> Show chords</label>`
      : '';
  const html = `<!doctype html><html><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<style>body{margin:0;background:#16181a;color:#e8eaed;font:16px system-ui;display:grid;place-items:center;height:100vh}main{width:min(420px,calc(100vw - 48px));display:grid;gap:18px}h1{margin:0;font-size:26px}p{color:#a9b0b6;margin:0}label{display:grid;gap:7px}input[type=text]{font:inherit;padding:10px;border-radius:7px;border:1px solid #4a4f54;background:#222528;color:inherit}button{font:inherit;font-weight:650;padding:11px;border:0;border-radius:7px;background:#d9962f;color:#151515}</style>
<main><h1>Set up ${PRODUCT_NAME}</h1><p>This is needed only once. You can change it later in Settings.</p><label>Device name<input id="name" type="text" maxlength="60" autofocus required></label>${stageOptions}<label><span><input id="auto" type="checkbox" ${ROLE === 'stage' ? 'checked' : ''}> Open when this computer starts</span></label><button id="continue">Continue</button></main>
<script>document.getElementById('continue').onclick=async()=>{const name=document.getElementById('name').value.trim();if(!name){document.getElementById('name').focus();return}await window.worshipClient.completeSetup({name,showChords:document.getElementById('chords')?.checked??true,autoStart:document.getElementById('auto').checked})}</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function openClient(): void {
  if (!win) return;
  void win.loadURL(`${shellUrl}${clientRoute()}`);
  if (ROLE === 'stage') win.setKiosk(settings.fullscreen);
}

function setPreventSleep(on: boolean): void {
  if (on && sleepBlocker === null)
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
}

function setAutoStart(on: boolean): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: on });
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    console.warn('could not change launch-at-login:', error);
    return false;
  }
}

type EditableClientSettings = Partial<
  Pick<ClientSettings, 'name' | 'showChords' | 'autoStart' | 'fullscreen' | 'preventSleep'>
>;

function updateClientSettings(patch: EditableClientSettings): ClientSettings {
  const previous = settings;
  const requestedName =
    patch.name === undefined ? settings.name : patch.name.trim().slice(0, 60);
  if (!requestedName) throw new Error('A device name is required.');
  settings = {
    ...settings,
    ...patch,
    name: requestedName,
    autoStart:
      patch.autoStart === undefined
        ? settings.autoStart
        : setAutoStart(Boolean(patch.autoStart)),
    setupComplete: true,
  };
  setPreventSleep(settings.preventSleep);
  saveClientSettings(settings);

  if (ROLE === 'stage' && previous.fullscreen !== settings.fullscreen) {
    win?.setKiosk(settings.fullscreen);
  }
  if (previous.name !== settings.name || previous.showChords !== settings.showChords) {
    // Let the IPC reply reach the settings panel before navigation destroys its frame.
    setTimeout(openClient, 0);
  }
  return settings;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: ROLE === 'stage' ? 1280 : 1100,
    height: ROLE === 'stage' ? 720 : 760,
    minWidth: 380,
    minHeight: 480,
    show: false,
    backgroundColor: '#16181a',
    title: PRODUCT_NAME,
    autoHideMenuBar: true,
    fullscreen: ROLE === 'stage' && settings.fullscreen,
    webPreferences: {
      preload: join(RESOURCES, 'client-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL(settings.setupComplete ? `${shellUrl}${clientRoute()}` : setupPage());
  if (ROLE === 'stage' && settings.setupComplete) win.setKiosk(settings.fullscreen);
}

function registerIpc(): void {
  ipcMain.handle('worship-client:state', () => ({
    ...settings,
    role: ROLE,
    connected: leader !== null,
  }));
  ipcMain.handle(
    'worship-client:complete-setup',
    (_event, patch: Pick<ClientSettings, 'name' | 'showChords' | 'autoStart'>) => {
      const name = typeof patch.name === 'string' ? patch.name.trim().slice(0, 60) : '';
      if (!name) throw new Error('A device name is required.');
      updateClientSettings({
        name,
        showChords: Boolean(patch.showChords),
        autoStart: Boolean(patch.autoStart),
      });
    },
  );
  ipcMain.handle('worship-client:update-settings', (_event, patch: EditableClientSettings) =>
    updateClientSettings(patch),
  );
}

async function bootstrap(): Promise<void> {
  settings = loadClientSettings(ROLE);
  saveClientSettings(settings);
  setPreventSleep(settings.preventSleep);
  registerIpc();
  await startShellServer();
  startDiscovery();
  createWindow();
}

if (app.hasSingleInstanceLock()) {
  void app.whenReady().then(bootstrap);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    browser?.stop();
    discovery?.destroy();
    shellServer?.close();
    if (sleepBlocker !== null) powerSaveBlocker.stop(sleepBlocker);
  });
}
