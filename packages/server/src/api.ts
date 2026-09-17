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
import type { Library } from './library.js';

export interface ApiOptions {
  library: Library;
  /** Directory of the built UI. When absent, only the API is served. */
  uiDir?: string | undefined;
  logger?: boolean | undefined;
}

export function createServer(options: ApiOptions): FastifyInstance {
  const { library } = options;
  const app = Fastify({ logger: options.logger ?? false });

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

  app.post('/api/reindex', async () => library.reindex());

  if (options.uiDir && existsSync(options.uiDir)) {
    app.register(fastifyStatic, { root: options.uiDir });
    // Client-side routing: anything that is not an API route falls through to the app.
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
