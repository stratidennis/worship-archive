/**
 * Server entry point.
 *
 * Runs standalone in development and is imported by the Electron main process in
 * production. Binds every interface, because the whole point is that band devices on
 * the same WiFi can reach it.
 */

import { networkInterfaces } from 'node:os';
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

const options: { library: Library; sets: SetStore; uiDir?: string; hub?: SessionHub } = {
  library,
  sets,
  ...(uiDir ? { uiDir } : {}),
};
const app = createServer(options);

await app.listen({ port, host: '0.0.0.0' });

// The hub upgrades connections on the HTTP server, so it can only exist once Fastify
// has one — that is after listen().
const hub = new SessionHub(app.server, { statePath: resolve(dataDir, 'session.json') });
options.hub = hub;
hubRef = hub;

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);

console.log(`\n  Local:   http://localhost:${port}`);
for (const address of addresses) console.log(`  Network: http://${address}:${port}`);
console.log('');

const shutdown = async (): Promise<void> => {
  hub.close();
  await watcher.close();
  await app.close();
  library.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
