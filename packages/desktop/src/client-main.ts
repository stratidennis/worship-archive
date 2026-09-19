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
import { createSocket, type Socket as DgramSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import Bonjour, { type Browser, type Service } from 'bonjour-service';
import WebSocket, { WebSocketServer } from 'ws';
import {
  LAN_DISCOVERY_PORT,
  LAN_DISCOVERY_REQUEST,
  SESSION_PROTOCOL_VERSION,
} from '@worship/core';
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
let udpDiscovery: DgramSocket | null = null;
let udpTimer: NodeJS.Timeout | null = null;
let leader: LeaderEndpoint | null = null;
let sleepBlocker: number | null = null;
const mdnsLeaders = new Map<string, LeaderEndpoint>();
const udpLeaders = new Map<string, LeaderEndpoint & { seenAt: number }>();

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
  const leaders = new Map<string, LeaderEndpoint>();
  for (const endpoint of udpLeaders.values()) leaders.set(endpoint.id, endpoint);
  // Prefer the richer mDNS result when both discovery paths found the same Leader.
  for (const endpoint of mdnsLeaders.values()) leaders.set(endpoint.id, endpoint);
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
    mdnsLeaders.set(endpoint.id, endpoint);
    selectLeader();
  });
  browser.on('down', (service) => {
    const endpoint = serviceEndpoint(service);
    if (!endpoint) return;
    mdnsLeaders.delete(endpoint.id);
    selectLeader();
  });
}

function ipv4Broadcasts(): string[] {
  const addresses = new Set(['255.255.255.255']);
  const toNumber = (address: string): number | null => {
    const parts = address.split('.').map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return null;
    return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
  };
  const fromNumber = (value: number): string =>
    [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');

  for (const entry of Object.values(networkInterfaces()).flat()) {
    if (!entry || entry.internal || entry.family !== 'IPv4') continue;
    const address = toNumber(entry.address);
    const mask = toNumber(entry.netmask);
    if (address === null || mask === null) continue;
    addresses.add(fromNumber((address | (~mask >>> 0)) >>> 0));
  }
  return [...addresses];
}

/** A broadcast fallback for Windows and networks where mDNS browsing is unavailable. */
function startUdpDiscovery(): void {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  udpDiscovery = socket;

  socket.on('message', (message, remote) => {
    try {
      const value = JSON.parse(message.toString('utf8')) as Record<string, unknown>;
      if (
        value['app'] !== 'worship-archive' ||
        value['role'] !== 'leader' ||
        Number(value['protocol']) !== SESSION_PROTOCOL_VERSION ||
        typeof value['leaderId'] !== 'string' ||
        !value['leaderId'] ||
        typeof value['port'] !== 'number' ||
        !Number.isInteger(value['port']) ||
        value['port'] < 1 ||
        value['port'] > 65535
      )
        return;
      udpLeaders.set(value['leaderId'], {
        id: value['leaderId'],
        name: typeof value['name'] === 'string' ? value['name'] : 'Worship Archive',
        host: remote.address,
        port: value['port'],
        seenAt: Date.now(),
      });
      selectLeader();
    } catch {
      // Other software can use this UDP port; unrelated packets are simply ignored.
    }
  });
  socket.on('error', (error) => console.warn('LAN discovery fallback error:', error));

  const discover = (): void => {
    const cutoff = Date.now() - 10_000;
    for (const [id, endpoint] of udpLeaders) {
      if (endpoint.seenAt < cutoff) udpLeaders.delete(id);
    }
    selectLeader();
    const request = Buffer.from(LAN_DISCOVERY_REQUEST);
    for (const address of ipv4Broadcasts()) {
      socket.send(request, LAN_DISCOVERY_PORT, address, () => undefined);
    }
  };

  socket.bind(0, '0.0.0.0', () => {
    socket.setBroadcast(true);
    discover();
    udpTimer = setInterval(discover, 2500);
    udpTimer.unref();
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
      const queued: { data: WebSocket.RawData; binary: boolean }[] = [];

      client.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else if (upstream.readyState === WebSocket.CONNECTING) queued.push({ data, binary });
      });
      upstream.on('open', () => {
        for (const frame of queued) upstream.send(frame.data, { binary: frame.binary });
        queued.length = 0;
      });
      upstream.on('message', (data, binary) => {
        // `ws` represents text frames as Buffer too. Passing that Buffer without this
        // flag turns it into a binary browser message (Blob), which the renderer quite
        // correctly refuses to JSON.parse. Preserve the frame type in both directions.
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
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

let preparedUi: Promise<void> | null = null;

/**
 * Electron does not need the PWA's offline shell: the UI is already inside the app.
 * Clear only service-worker and HTTP caches once per launch so an upgraded desktop app
 * can never keep rendering an older browser layout. IndexedDB and localStorage stay
 * untouched, preserving downloaded songs and every per-device preference.
 */
function loadCurrentUi(target: BrowserWindow, path: string): void {
  preparedUi ??= Promise.all([
    target.webContents.session.clearStorageData({
      origin: shellUrl,
      storages: ['serviceworkers', 'cachestorage'],
    }),
    target.webContents.session.clearCache(),
  ]).then(() => undefined);

  void preparedUi
    .catch((error: unknown) => console.warn('could not clear the old UI cache:', error))
    .then(() => {
      if (!target.isDestroyed()) void target.loadURL(`${shellUrl}${path}`);
    });
}

function openClient(): void {
  if (!win) return;
  loadCurrentUi(win, clientRoute());
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
  loadCurrentUi(win, settings.setupComplete ? clientRoute() : '/device-setup');
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
  ipcMain.handle('worship-client:quit', () => app.quit());
}

async function bootstrap(): Promise<void> {
  settings = loadClientSettings(ROLE);
  saveClientSettings(settings);
  setPreventSleep(settings.preventSleep);
  registerIpc();
  await startShellServer();
  startDiscovery();
  startUdpDiscovery();
  createWindow();
}

if (app.hasSingleInstanceLock()) {
  void app.whenReady().then(bootstrap);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    browser?.stop();
    discovery?.destroy();
    if (udpTimer) clearInterval(udpTimer);
    try {
      udpDiscovery?.close();
    } catch {
      // A bind rejected by the operating system leaves no socket to close.
    }
    shellServer?.close();
    if (sleepBlocker !== null) powerSaveBlocker.stop(sleepBlocker);
  });
}
