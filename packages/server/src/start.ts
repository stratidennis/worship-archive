/**
 * Starting the whole system, in one call.
 *
 * Both entry points use this: `main.ts` for `pnpm dev`, and the Electron main process
 * for the packaged app. They must not drift, because the desktop app is not a different
 * product — it is this server with a window attached, and a bug that exists in only one
 * of them is a bug nobody can reproduce.
 */

import { hostname, networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { FastifyInstance } from 'fastify';
import { createServer } from './api.js';
import { Library } from './library.js';
import { SetStore } from './sets.js';
import { SessionHub } from './hub.js';

export interface StartOptions {
  /** Where the `.chopro` files live. Created if missing. */
  dataDir: string;
  /** Preferred port. If taken, the next few are tried — see `portRetries`. */
  port?: number;
  /** Directory of the built UI. Without it only the API is served. */
  uiDir?: string | undefined;
  /** How many ports to try after `port` before giving up. */
  portRetries?: number;
  /** Publish an mDNS service record. Off in tests, which should not touch the network. */
  mdns?: boolean;
  /** Watch the library folder and reindex on change. */
  watch?: boolean;
  log?: (message: string) => void;
}

export interface RunningServer {
  app: FastifyInstance;
  library: Library;
  sets: SetStore;
  hub: SessionHub;
  port: number;
  /** `http://localhost:<port>` — what the host's own window should load. */
  url: string;
  /** Every address a band device could reach this on. */
  addresses: string[];
  hostname: string;
  stop: () => Promise<void>;
}

interface MdnsPublisher {
  unpublishAll: (callback?: () => void) => void;
  destroy: () => void;
}

const MDNS_TYPE = 'worship-archive';

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/**
 * Advertise over mDNS.
 *
 * Note what this does and does not buy. It publishes a *service* record, which a native
 * client browsing `_http._tcp.local` can find — but it does **not** create a resolvable
 * hostname, so `http://worship-archive.local` does not work in a browser. What does work
 * is the machine's own `.local` name, which macOS and Windows advertise themselves.
 * That is why the QR code is the primary way in rather than a nicety.
 *
 * The instance name carries the machine name, because two hosts on one network is a
 * normal Sunday — someone rehearsing in a side room while the service is set up in the
 * hall — and `worship-archive` on its own collides.
 */
async function publishMdns(
  port: number,
  log: (m: string) => void,
): Promise<MdnsPublisher | null> {
  try {
    const { Bonjour } = await import('bonjour-service');
    const instance = new Bonjour();
    const service = instance.publish({
      name: `${MDNS_TYPE} (${hostname().replace(/\.local$/, '')})`,
      type: 'http',
      port,
      txt: { app: MDNS_TYPE },
    });
    /*
      A publish failure arrives asynchronously, long after the try/catch has returned —
      a duplicate name on the network is the common one. Without this listener it is an
      unhandled 'error' event, which in the Electron main process means the app can die
      mid-service over a naming collision. mDNS is a convenience; the QR code and the
      raw addresses are the paths that always work, so the only right response is to say
      so and carry on.
    */
    service.on('error', (error: unknown) => {
      log(`  mDNS advertisement failed (${String(error)}) — use the QR code or an IP address`);
    });
    return instance as unknown as MdnsPublisher;
  } catch (error) {
    log(`  mDNS unavailable (${String(error)}) — use the QR code or an IP address`);
    return null;
  }
}

/**
 * Listen, moving to the next port if this one is taken.
 *
 * A packaged app that refuses to start because some unrelated process holds 7374 would
 * be inexplicable to a musician five minutes before a service. Moving is always better
 * than failing — the port is discovered by the join screen anyway, never typed.
 */
async function listenSomewhere(
  app: FastifyInstance,
  first: number,
  retries: number,
): Promise<number> {
  for (let port = first; port <= first + retries; port++) {
    try {
      await app.listen({ port, host: '0.0.0.0' });
      return port;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || port === first + retries) throw error;
    }
  }
  /* c8 ignore next */
  throw new Error('unreachable');
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const log = options.log ?? ((message: string): void => console.log(message));
  const dataDir = resolve(options.dataDir);

  const library = new Library(dataDir);
  const sets = new SetStore(dataDir, library.db);
  const initial = library.reindex();
  sets.reindex();
  log(
    `Library ${dataDir}: ${library.stats().songs} songs ` +
      `(+${initial.added} ~${initial.updated} -${initial.removed})`,
  );
  for (const f of initial.failed) log(`  could not read ${f.path}: ${f.error}`);

  const serverOptions: Parameters<typeof createServer>[0] = {
    library,
    sets,
    port: options.port ?? 7374,
    mdnsName: `${MDNS_TYPE}.local`,
    ...(options.uiDir ? { uiDir: options.uiDir } : {}),
  };
  const app = createServer(serverOptions);

  const port = await listenSomewhere(app, options.port ?? 7374, options.portRetries ?? 10);
  serverOptions.port = port;

  // The hub upgrades connections on the HTTP server, so it can only exist once Fastify
  // has one — that is after listen().
  const hub = new SessionHub(app.server, { statePath: resolve(dataDir, 'session.json') });
  serverOptions.hub = hub;

  // Editing a .chopro by hand, or pulling from git, must show up without a restart.
  let watcher: FSWatcher | null = null;
  if (options.watch ?? true) {
    watcher = chokidar.watch([library.songsDir, sets.setsDir], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    let pending: NodeJS.Timeout | null = null;
    const scheduleReindex = (): void => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        const r = library.reindex();
        const s = sets.reindex();
        if (r.added || r.updated || r.removed || s.added || s.updated || s.removed) {
          hub.notifyLibraryChanged();
          log(
            `Reindexed: songs +${r.added} ~${r.updated} -${r.removed}, ` +
              `sets +${s.added} ~${s.updated} -${s.removed}`,
          );
        }
      }, 150);
    };
    watcher
      .on('add', scheduleReindex)
      .on('change', scheduleReindex)
      .on('unlink', scheduleReindex);
  }

  const bonjour = (options.mdns ?? true) ? await publishMdns(port, log) : null;

  return {
    app,
    library,
    sets,
    hub,
    port,
    url: `http://localhost:${port}`,
    addresses: lanAddresses(),
    hostname: hostname(),
    stop: async (): Promise<void> => {
      bonjour?.unpublishAll(() => bonjour.destroy());
      hub.close();
      await watcher?.close();
      await app.close();
      library.close();
    },
  };
}
