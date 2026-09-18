import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ServiceSet, Song } from '@worship/core';
import { Library } from '../src/library.js';
import { SetStore } from '../src/sets.js';
import { SessionHub } from '../src/hub.js';
import { createServer } from '../src/api.js';

/**
 * Telling the room that something changed.
 *
 * Every connected device holds the whole set in memory and never refetches on its own,
 * which is what keeps a phone useful when the WiFi drops mid-song. The price is that a
 * change made on the host is invisible until the host says so — and for a long while
 * it did not: the leader could change a song's key on the set page, save it to disk,
 * and watch the stage go on showing the old one until every device was reloaded by
 * hand.
 */

let dir: string;
let library: Library;
let sets: SetStore;
let hub: SessionHub;
let app: FastifyInstance;
let http: ReturnType<typeof createHttpServer>;
let told: ReturnType<typeof vi.fn>;

const song = (overrides: Partial<Song> = {}): Song =>
  ({
    id: 'song-1',
    legacyUuid: null,
    title: 'A Ta Putere',
    writtenKey: 'G',
    performanceKey: null,
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: [],
    arrangement: null,
    lang: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 0,
    ...overrides,
  }) satisfies Song;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-live-'));
  mkdirSync(join(dir, 'songs'), { recursive: true });
  library = new Library(dir);
  sets = new SetStore(dir, library.db);
  http = createHttpServer();
  hub = new SessionHub(http, {});
  told = vi.fn();
  hub.notifyLibraryChanged = told;
  app = createServer({ library, sets, hub });
});

afterEach(async () => {
  hub.close();
  await app.close();
  http.close();
  library.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('what the screens are told about', () => {
  /*
    The one that matters most: key and capo are chosen per song on the set page, and
    they are the leader's decision about how the song is being played today. A decision
    the screens never hear about is not a decision.
  */
  it('a set being saved — which is how the leader sets a key or a capo', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/sets', payload: {} });
    const set = created.json() as ServiceSet;
    told.mockClear();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sets/${set.id}`,
      payload: {
        ...set,
        items: [{ kind: 'song', songId: 'song-1', keyOverride: 'A', capoOverride: 2 }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('a song being edited', async () => {
    await app.inject({ method: 'PUT', url: '/api/songs/song-1', payload: song() });
    expect(told).toHaveBeenCalled();
  });

  it('a song being deleted out from under a live set', async () => {
    await app.inject({ method: 'PUT', url: '/api/songs/song-1', payload: song() });
    told.mockClear();
    await app.inject({ method: 'DELETE', url: '/api/songs/song-1' });
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('a set being deleted', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/sets', payload: {} });
    told.mockClear();
    await app.inject({
      method: 'DELETE',
      url: `/api/sets/${(created.json() as ServiceSet).id}`,
    });
    expect(told).toHaveBeenCalledTimes(1);
  });

  /*
    And not otherwise. Every one of these costs each connected device a refetch of the
    whole service, so reading has to stay free — a leader scrolling the archive on a
    Sunday morning must not have five phones refetching behind them.
  */
  it('never a mere read', async () => {
    await app.inject({ method: 'PUT', url: '/api/songs/song-1', payload: song() });
    told.mockClear();
    await app.inject({ method: 'GET', url: '/api/songs/song-1' });
    await app.inject({ method: 'GET', url: '/api/sets' });
    await app.inject({ method: 'GET', url: '/api/search?q=putere' });
    expect(told).not.toHaveBeenCalled();
  });

  it('never a write that failed', async () => {
    await app.inject({ method: 'DELETE', url: '/api/songs/nothing-here' });
    await app.inject({ method: 'DELETE', url: '/api/sets/nothing-here' });
    await app.inject({ method: 'PUT', url: '/api/sets/whatever', payload: 'not a set' });
    expect(told).not.toHaveBeenCalled();
  });
});
