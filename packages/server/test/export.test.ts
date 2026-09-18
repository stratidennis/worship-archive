import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library, libraryFingerprint } from '../src/library.js';
import { SetStore } from '../src/sets.js';
import { createServer } from '../src/api.js';
import type { FastifyInstance } from 'fastify';

let dir: string;
let library: Library;
let sets: SetStore;
let app: FastifyInstance;

const SONG = (id: string, title: string) => `{title: ${title}}
{key: G}
{x_id: ${id}}

{start_of_verse: V1}
Vreau să cânt bunătatea [G]Ta
{end_of_verse}
`;

function writeSong(name: string, text: string): void {
  const full = join(dir, 'songs', name);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text, 'utf8');
}

async function exportWith(since?: string): Promise<{ status: number; body: unknown }> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await app.inject({ method: 'GET', url: `/api/library/export${query}` });
  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? null : response.json(),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-export-'));
  library = new Library(dir);
  sets = new SetStore(dir, library.db);
  app = createServer({ library, sets });
});

afterEach(async () => {
  await app.close();
  library.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the library fingerprint', () => {
  it('changes when a song is removed', () => {
    const a = { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'b', updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(libraryFingerprint([a, b], [])).not.toBe(libraryFingerprint([a], []));
  });

  it('changes when a song is edited', () => {
    const before = [{ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }];
    const after = [{ id: 'a', updatedAt: '2026-01-02T00:00:00.000Z' }];
    expect(libraryFingerprint(before, [])).not.toBe(libraryFingerprint(after, []));
  });

  it('does not depend on the order it is handed', () => {
    const a = { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'b', updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(libraryFingerprint([a, b], [])).toBe(libraryFingerprint([b, a], []));
  });

  it('tells a song apart from a set with the same id', () => {
    const item = { id: 'same', updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(libraryFingerprint([item], [])).not.toBe(libraryFingerprint([], [item]));
  });
});

describe('exporting the library', () => {
  it('sends everything when the client has nothing', async () => {
    writeSong('a.chopro', SONG('id-a', 'Una'));
    library.reindex();

    const { status, body } = await exportWith();
    expect(status).toBe(200);
    expect((body as { songs: unknown[] }).songs).toHaveLength(1);
    expect((body as { fingerprint: string }).fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it('answers 204 when the fingerprint still matches', async () => {
    writeSong('a.chopro', SONG('id-a', 'Una'));
    library.reindex();

    const first = await exportWith();
    const { fingerprint } = first.body as { fingerprint: string };
    expect((await exportWith(fingerprint)).status).toBe(204);
  });

  it('sends a full export after a song is deleted', async () => {
    // The bug this replaced: deletion can only *lower* the newest `updatedAt`, so a
    // timestamp check kept answering "unchanged" and every device held the deleted song
    // for ever — and could edit it back into existence.
    writeSong('a.chopro', SONG('id-a', 'Una'));
    writeSong('b.chopro', SONG('id-b', 'Două'));
    library.reindex();

    const { body } = await exportWith();
    const { fingerprint } = body as { fingerprint: string };
    expect((await exportWith(fingerprint)).status).toBe(204);

    library.delete('id-b');

    const after = await exportWith(fingerprint);
    expect(after.status).toBe(200);
    expect((after.body as { songs: unknown[] }).songs).toHaveLength(1);
  });

  it('sends a full export after a set is deleted', async () => {
    const stored = sets.save({
      id: 'set-1',
      title: 'Duminică',
      date: '2026-01-04',
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rev: 0,
    });
    expect(stored.id).toBe('set-1');

    const { body } = await exportWith();
    const { fingerprint } = body as { fingerprint: string };
    expect((await exportWith(fingerprint)).status).toBe(204);

    sets.delete('set-1');
    const after = await exportWith(fingerprint);
    expect(after.status).toBe(200);
    expect((after.body as { sets: unknown[] }).sets).toHaveLength(0);
  });

  it('sends a full export after an edit', async () => {
    writeSong('a.chopro', SONG('id-a', 'Una'));
    library.reindex();
    const { body } = await exportWith();
    const { fingerprint } = body as { fingerprint: string };

    const song = library.get('id-a')!;
    library.save({ ...song, title: 'Redenumită' });

    expect((await exportWith(fingerprint)).status).toBe(200);
  });

  it('ignores a fingerprint it has never issued', async () => {
    writeSong('a.chopro', SONG('id-a', 'Una'));
    library.reindex();
    expect((await exportWith('not-a-real-fingerprint')).status).toBe(200);
  });
});

describe('deleting', () => {
  /*
    The UI used to send `content-type: application/json` on every request, body or not.
    Fastify then tried to parse an empty body and answered 400, so deleting a song or a
    set never worked — quietly, because the row simply stayed put. These pin the
    contract from the server's side: a DELETE carries no body, and must not need one.
  */
  it('accepts a DELETE with no body at all', async () => {
    writeSong('a.chopro', SONG('id-a', 'Una'));
    library.reindex();

    const response = await app.inject({ method: 'DELETE', url: '/api/songs/id-a' });
    expect(response.statusCode).toBe(204);
    expect(library.stats().songs).toBe(0);
  });

  it('accepts a DELETE that declares JSON and sends nothing', async () => {
    writeSong('b.chopro', SONG('id-b', 'Două'));
    library.reindex();

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/songs/id-b',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(204);
  });

  it('deletes a set the same way', async () => {
    sets.save({
      id: 'set-1',
      title: '2026-01-04',
      date: '2026-01-04',
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rev: 0,
    });
    const response = await app.inject({ method: 'DELETE', url: '/api/sets/set-1' });
    expect(response.statusCode).toBe(204);
    expect(sets.list()).toHaveLength(0);
  });
});

describe('asking for something that is not there', () => {
  it('404s a missing set, so a client can tell gone from unreachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sets/nope/full' });
    expect(response.statusCode).toBe(404);
  });

  it('404s a missing song', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/songs/nope' });
    expect(response.statusCode).toBe(404);
  });
});
