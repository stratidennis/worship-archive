/**
 * HTTP API.
 *
 * Deliberately plain REST over the library index. The renderer in Electron talks to
 * this exactly as a phone on the WiFi does — there is no privileged local path — so
 * the web and desktop builds cannot drift apart.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import {
  DEFAULT_STAGE_DISPLAY,
  type HostDisplay,
  isStageDisplayEmpty,
  patchStageDisplay,
  type ServiceSet,
  type Song,
  type StageDisplay,
} from '@worship/core';
import { libraryFingerprint, type Library } from './library.js';
import type { SetStore } from './sets.js';
import type { SessionHub } from './hub.js';
import { auditLibrary, applyFixes, type Fix } from './cleanup.js';
import { backupFilename, createBackup, isBackup, restoreBackup } from './backup.js';

export interface ApiOptions {
  library: Library;
  sets: SetStore;
  /** Attached after the HTTP server exists, since the hub upgrades its connections. */
  hub?: SessionHub | undefined;
  /** Advertised to clients so the QR code points somewhere reachable. */
  port?: number | undefined;
  mdnsName?: string | undefined;
  /** Directory of the built UI. When absent, only the API is served. */
  uiDir?: string | undefined;
  logger?: boolean | undefined;
}

export function createServer(options: ApiOptions): FastifyInstance {
  const { library, sets } = options;
  // A backup POST carries the whole library. 1 MB (Fastify's default) is enough for
  // 153 songs and not enough for a library that has grown, and a 413 at restore time
  // would be inexplicable. 64 MB is far past any plausible text library.
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 * 1024 });

  /*
    An empty body is not a malformed one.

    Fastify's built-in JSON parser rejects `content-type: application/json` with nothing
    after it, which is what a `fetch` DELETE that sets its headers uniformly sends — and
    a 400 there is both confusing and, for a DELETE, meaningless: the request carried
    everything it needed in the URL. Being strict here bought nothing and cost every
    delete in the app.
  */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const text = String(body).trim();
      if (text === '') return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // The LAN is the trust boundary here, not the browser origin — band devices load the
  // app from this same server. CORS is open so a Vite dev server on another port works.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'content-type');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  });
  app.options('/api/*', async (_req, reply) => reply.code(204).send());

  app.get('/api/stats', async () => ({
    ...library.stats(),
    songsDir: library.songsDir,
  }));

  app.get('/api/facets', async () => ({
    collections: library.collections(),
    tags: library.tags(),
    keys: library.keys(),
  }));

  app.get('/api/songs', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    return library.list({
      collection: q['collection'],
      tag: q['tag'],
      key: q['key'],
      sort: q['sort'] === 'updated' ? 'updated' : 'title',
    });
  });

  app.get('/api/search', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const term = q['q'];
    if (!term || term.trim() === '') return reply.send([]);
    return library.search(term, Number(q['limit'] ?? 50) || 50);
  });

  app.get('/api/songs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const song = library.get(id);
    if (!song) return reply.code(404).send({ error: 'not found' });
    return song;
  });

  /**
   * Create or overwrite a song.
   *
   * The previous version is snapshotted before the file is written, so no edit can be
   * unrecoverable. `rev` is bumped server-side rather than trusted from the client.
   */
  app.put('/api/songs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const incoming = request.body as Song | undefined;
    if (!incoming || typeof incoming !== 'object') {
      return reply.code(400).send({ error: 'expected a song document' });
    }
    // `rev`, `createdAt` and `updatedAt` are the library's to set, not the client's.
    const saved = library.save({ ...incoming, id });
    /*
      Tell the room.

      Every device holds the whole set in memory and never refetches on its own — that
      is what keeps a phone useful when the WiFi drops mid-song. The cost is that a
      change made here is invisible until somebody says so, and the leader changing a
      song's key on the set page and watching nothing happen on the stage is exactly
      the failure that buys.
    */
    options.hub?.notifyLibraryChanged();
    return saved;
  });

  app.post('/api/songs', async (request, reply) => {
    const incoming = (request.body ?? {}) as Partial<Song>;
    const now = new Date().toISOString();
    const song: Song = {
      id: randomUUID(),
      legacyUuid: null,
      title: incoming.title ?? '',
      writtenKey: incoming.writtenKey ?? null,
      performanceKey: incoming.performanceKey ?? null,
      tempo: incoming.tempo ?? null,
      timeSignature: incoming.timeSignature ?? null,
      authors: incoming.authors ?? [],
      copyright: incoming.copyright ?? null,
      ccli: incoming.ccli ?? null,
      tags: incoming.tags ?? [],
      collectionIds: incoming.collectionIds ?? [],
      blocks: incoming.blocks ?? [],
      arrangement: incoming.arrangement ?? null,
      lang: incoming.lang ?? null,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    };
    return reply.code(201).send(library.save(song));
  });

  app.delete('/api/songs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!library.delete(id)) return reply.code(404).send({ error: 'not found' });
    options.hub?.notifyLibraryChanged();
    return reply.code(204).send();
  });

  app.get('/api/songs/:id/revisions', async (request) => {
    const { id } = request.params as { id: string };
    return library.revisions(id);
  });

  app.get('/api/songs/:id/revisions/:rev', async (request, reply) => {
    const { id, rev } = request.params as { id: string; rev: string };
    const song = library.revision(id, Number(rev));
    if (!song) return reply.code(404).send({ error: 'not found' });
    return song;
  });

  app.post('/api/songs/:id/revisions/:rev/restore', async (request, reply) => {
    const { id, rev } = request.params as { id: string; rev: string };
    const song = library.revert(id, Number(rev));
    if (!song) return reply.code(404).send({ error: 'not found' });
    options.hub?.notifyLibraryChanged();
    return song;
  });

  // ---- service sets --------------------------------------------------------

  app.get('/api/sets', async () => sets.list());

  app.get('/api/sets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const set = sets.get(id);
    if (!set) return reply.code(404).send({ error: 'not found' });
    return set;
  });

  app.post('/api/sets', async (request, reply) => {
    const incoming = (request.body ?? {}) as Partial<ServiceSet>;
    const now = new Date().toISOString();
    return reply.code(201).send(
      sets.save({
        id: randomUUID(),
        title: incoming.title ?? '',
        date: incoming.date ?? null,
        items: incoming.items ?? [],
        createdAt: now,
        updatedAt: now,
        rev: 0,
      }),
    );
  });

  app.put('/api/sets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const incoming = request.body as ServiceSet | undefined;
    if (!incoming || typeof incoming !== 'object') {
      return reply.code(400).send({ error: 'expected a set document' });
    }
    const saved = sets.save({ ...incoming, id });
    options.hub?.notifyLibraryChanged();
    return saved;
  });

  app.post('/api/sets/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { title?: string; date?: string | null };
    const copy = sets.duplicate(id, body);
    if (!copy) return reply.code(404).send({ error: 'not found' });
    return reply.code(201).send(copy);
  });

  app.delete('/api/sets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sets.delete(id)) return reply.code(404).send({ error: 'not found' });
    options.hub?.notifyLibraryChanged();
    return reply.code(204).send();
  });

  /**
   * A set with every referenced song embedded.
   *
   * One request for the whole service: the print view needs it, and so will the live
   * session, which must keep working when the network drops mid-song.
   */
  app.get('/api/sets/:id/full', async (request, reply) => {
    const { id } = request.params as { id: string };
    const set = sets.get(id);
    if (!set) return reply.code(404).send({ error: 'not found' });
    const songs: Record<string, Song> = {};
    for (const item of set.items) {
      if (item.kind !== 'song') continue;
      const song = library.get(item.songId);
      if (song) songs[item.songId] = song;
    }
    return { set, songs };
  });

  /**
   * The whole library in one response, for clients to mirror.
   *
   * `since` carries the fingerprint the client already holds, and an exact match skips
   * the transfer — the usual case on arriving at church with last week's songs.
   */
  app.get('/api/library/export', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const songs = library.all();
    const allSets = sets.all();
    const fingerprint = libraryFingerprint(songs, allSets);
    if (q['since'] && q['since'] === fingerprint) {
      return reply.code(204).send();
    }
    return { songs, sets: allSets, fingerprint, exportedAt: new Date().toISOString() };
  });

  /**
   * How to reach this host, for the QR code and the join screen.
   *
   * Every LAN address is offered rather than a guess: a laptop on both WiFi and
   * Ethernet has two, and only one of them is the network the band is on.
   *
   * `hostname` is the machine's own `.local` name, which macOS and Windows advertise
   * over mDNS themselves. It is the one name that actually resolves in a browser — our
   * own service advertisement does not create one.
   */
  app.get('/api/host', async () => {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .filter((i) => i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    return {
      addresses,
      port: options.port ?? 7374,
      hostname: hostname(),
    };
  });

  // ---- backup, restore, cleanup ---------------------------------------------

  /**
   * The whole library as one JSON file.
   *
   * `Content-Disposition` so a browser downloads it rather than rendering a megabyte of
   * JSON — the desktop app ignores the header and writes it wherever the user chose.
   */
  app.get('/api/backup', async (_request, reply) => {
    const backup = createBackup(library, sets);
    reply.header('Content-Disposition', `attachment; filename="${backupFilename()}"`);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return backup;
  });

  app.post('/api/restore', async (request, reply) => {
    const body = request.body as { backup?: unknown; mode?: 'merge' | 'replace' } | undefined;
    const candidate = body && 'backup' in body ? body.backup : body;
    if (!isBackup(candidate)) {
      return reply.code(400).send({ error: 'not a Worship Archive backup file' });
    }
    const result = restoreBackup(library, sets, candidate, {
      mode: body?.mode === 'replace' ? 'replace' : 'merge',
    });
    options.hub?.notifyLibraryChanged();
    return result;
  });

  /** Proposed chord-spelling fixes across the whole library. Never applied here. */
  app.get('/api/cleanup', async () => auditLibrary(library));

  app.post('/api/cleanup/apply', async (request, reply) => {
    const body = request.body as { fixes?: Fix[] } | undefined;
    if (!body || !Array.isArray(body.fixes)) {
      return reply.code(400).send({ error: 'expected { fixes: [...] }' });
    }
    const result = applyFixes(library, body.fixes);
    options.hub?.notifyLibraryChanged();
    return result;
  });

  /*
    How the stage screens look, set from anywhere.

    Not over the session socket: the person adjusting this is at the settings page, and
    making them start leading a service in order to make the text bigger would be an
    odd price for it. The hub still broadcasts the change, so every screen picks it up
    at once.
  */
  app.put('/api/session/stage', async (request, reply) => {
    if (!options.hub) return reply.code(503).send({ error: 'no session' });
    const body = request.body as (Partial<StageDisplay> & { screen?: unknown }) | undefined;
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'bad body' });

    /*
      With a `screen`, this is about that one television; without one, about all of them.

      Named screens only. The name is the one in the screen's own address, which is
      also what the leader sees in the connected list — a connection id would be
      neither, and would be forgotten the moment the screen was switched off.
    */
    const screen = typeof body.screen === 'string' ? body.screen.trim().slice(0, 60) : '';
    const state = options.hub.getState();

    if (screen) {
      const next = patchStageDisplay(state.stageBy[screen] ?? DEFAULT_STAGE_DISPLAY, body);
      const stageBy = { ...state.stageBy };
      // A screen back to saying nothing is forgotten rather than stored as four nulls,
      // so the list of screens with settings of their own stays honest.
      if (isStageDisplayEmpty(next)) delete stageBy[screen];
      else stageBy[screen] = next;
      options.hub.patch({ stageBy });
      return { screen, stage: next };
    }

    const stage = patchStageDisplay(state.stage, body);
    options.hub.patch({ stage });
    return { stage };
  });

  /*
    What the leader's own screen looks like, for the screens following it.

    Over HTTP as well as through the socket because the leader is not always leading:
    somebody setting a hall up on a Tuesday, with no service running, still expects the
    televisions to match the laptop they are standing at.
  */
  app.put('/api/session/host', async (request, reply) => {
    if (!options.hub) return reply.code(503).send({ error: 'no session' });
    const body = request.body as Partial<HostDisplay> | undefined;
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'bad body' });
    // `auto` is not a look, it is a question, and the answer is the *host's* — which is
    // why the device resolves it before sending. See HostDisplay.
    const themes: HostDisplay['theme'][] = ['light', 'dark', 'stage'];
    const theme = themes.find((name) => name === body.theme);
    const language = body.language === 'en' || body.language === 'ro' ? body.language : null;
    if (!theme || !language) return reply.code(400).send({ error: 'bad body' });
    const host: HostDisplay = {
      theme,
      language,
      chordColor: typeof body.chordColor === 'string' ? body.chordColor : null,
    };
    options.hub.patch({ host });
    return { host };
  });

  app.get('/api/session', async () => ({
    state: options.hub?.getState() ?? null,
    devices: options.hub?.getDevices() ?? [],
  }));

  app.post('/api/reindex', async () => ({ songs: library.reindex(), sets: sets.reindex() }));

  if (options.uiDir && existsSync(options.uiDir)) {
    app.register(fastifyStatic, { root: options.uiDir });
    // Client-side routing: anything that is not an API route falls through to the app.
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    /*
      No interface to serve — this is the development server, with Vite hosting the app
      on its own port and proxying `/api` through to here.

      Worth saying out loud rather than answering `{"message":"Route GET:/band not
      found"}`, which is true and tells you nothing: the address looks like the app, it
      is the port the app's own join screen used to print, and the reply looks like the
      app is broken rather than like you are knocking on the wrong door.
    */
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply
        .code(404)
        .type('text/plain; charset=utf-8')
        .send(
          'This port serves the API only.\n\n' +
            'In development the app itself is served by Vite on another port — try ' +
            '7373 instead of this one. A packaged build serves both from here.\n',
        );
    });
  }

  return app;
}
