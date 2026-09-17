/**
 * Server entry point.
 *
 * Runs standalone in development and is imported by the Electron main process in
 * production. Binds every interface, because the whole point is that band devices on
 * the same WiFi can reach it.
 */

import { hostname, networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import chokidar from 'chokidar';
import { createServer } from './api.js';
import { Library } from './library.js';
import { SetStore } from './sets.js';
import { SessionHub } from './hub.js';

const dataDir = resolve(process.env['WORSHIP_DATA'] ?? './data');
const port = Number(process.env['PORT'] ?? 7374);
const uiDir = process.env['WORSHIP_UI'];

const library = new Library(dataDir);
const sets = new SetStore(dataDir, library.db);
const initial = library.reindex();
sets.reindex();
console.log(
  `Library ${dataDir}: ${library.stats().songs} songs ` +
    `(+${initial.added} ~${initial.updated} -${initial.removed})`,
);
for (const f of initial.failed) console.warn(`  could not read ${f.path}: ${f.error}`);

// Editing a .chopro by hand, or pulling from git, must show up without a restart.
const watcher = chokidar.watch([library.songsDir, sets.setsDir], {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});
// Assigned once the server is listening; the watcher may fire before then.
let hubRef: SessionHub | null = null;
let pending: NodeJS.Timeout | null = null;
const scheduleReindex = (): void => {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    const r = library.reindex();
    const s = sets.reindex();
    if (r.added || r.updated || r.removed || s.added || s.updated || s.removed) {
      hubRef?.notifyLibraryChanged();
      console.log(
        `Reindexed: songs +${r.added} ~${r.updated} -${r.removed}, ` +
          `sets +${s.added} ~${s.updated} -${s.removed}`,
      );
    }
  }, 150);
};
watcher.on('add', scheduleReindex).on('change', scheduleReindex).on('unlink', scheduleReindex);

const MDNS_NAME = 'worship-archive';

const options: {
  library: Library;
  sets: SetStore;
  uiDir?: string;
  hub?: SessionHub;
  port?: number;
  mdnsName?: string;
} = {
  library,
  sets,
  port,
  mdnsName: `${MDNS_NAME}.local`,
  ...(uiDir ? { uiDir } : {}),
};
const app = createServer(options);

await app.listen({ port, host: '0.0.0.0' });

// The hub upgrades connections on the HTTP server, so it can only exist once Fastify
// has one — that is after listen().
const hub = new SessionHub(app.server, { statePath: resolve(dataDir, 'session.json') });
options.hub = hub;
hubRef = hub;

/**
 * Advertise the service over mDNS.
 *
 * Note what this does and does not give you. It publishes a *service* record, which a
 * native client browsing `_http._tcp.local` can find — but it does **not** create a
 * resolvable hostname, so `http://worship-archive.local` does not work in a browser.
 *
 * What does work in a browser is the machine's own `.local` name, which macOS and
 * Windows already advertise without any help from us. That is what `/api/host` offers,
 * and it is why the QR code is the primary way in rather than a nicety: it cannot fail
 * silently, and some guest networks drop multicast altogether.
 */
interface MdnsPublisher {
  unpublishAll: (callback?: () => void) => void;
  destroy: () => void;
}

let bonjour: MdnsPublisher | null = null;
try {
  const { Bonjour } = await import('bonjour-service');
  const instance = new Bonjour();
  instance.publish({ name: MDNS_NAME, type: 'http', port, txt: { app: 'worship-archive' } });
  bonjour = instance as unknown as MdnsPublisher;
} catch (error) {
  console.warn(`  mDNS unavailable (${String(error)}) — use the QR code or an IP address`);
}

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);

console.log(`\n  Local:   http://localhost:${port}`);
for (const address of addresses) console.log(`  Network: http://${address}:${port}`);
console.log(`  Name:    http://${hostname()}:${port}`);
console.log('');

const shutdown = async (): Promise<void> => {
  bonjour?.unpublishAll(() => bonjour?.destroy());
  hub.close();
  await watcher.close();
  await app.close();
  library.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
