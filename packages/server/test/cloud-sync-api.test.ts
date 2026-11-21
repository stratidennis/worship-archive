import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createServer } from '../src/api.js';
import { syncCloudFolder } from '../src/cloud-sync.js';
import { prepareLibraryDirectory } from '../src/data-directory.js';
import { Library } from '../src/library.js';
import { SetStore } from '../src/sets.js';

const simulatedRead = vi.hoisted(() => ({
  before: null as ((path: unknown) => Promise<void>) | null,
}));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await simulatedRead.before?.(args[0]);
      return actual.readFile(...args);
    },
  };
});

it('acknowledges a delete and serves reads while the cloud mirror is busy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worship-cloud-api-'));
  const local = prepareLibraryDirectory(join(root, 'local'));
  const remote = prepareLibraryDirectory(join(root, 'remote'));
  const library = new Library(local.root);
  const sets = new SetStore(local.root, library.db);
  const app = createServer({ library, sets, cloudSyncDir: remote.root });
  const release = deferred();
  try {
    const now = new Date().toISOString();
    const set = sets.save({
      id: 'old-set',
      title: 'Old set',
      date: null,
      items: [],
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });
    await syncCloudFolder(local.root, remote.root);
    const previousFile = join(remote.setsDir, readdirSync(remote.setsDir)[0]!);

    const cloudRead = deferred();
    simulatedRead.before = async (path) => {
      if (path !== previousFile) return;
      cloudRead.resolve();
      await release.promise;
    };
    const deletion = await app.inject({ method: 'DELETE', url: `/api/sets/${set.id}` });
    expect(deletion.statusCode).toBe(204);
    await cloudRead.promise;
    const duringSync = await app.inject({ method: 'GET', url: '/api/sets' });
    expect(duringSync.json()).toEqual([]);
    expect(readdirSync(remote.setsDir)).toHaveLength(1);

    const nextWrite = app
      .inject({ method: 'POST', url: '/api/sets', payload: { title: 'New set' } })
      .then((response) => response);
    expect((await app.inject({ method: 'GET', url: '/api/sets' })).json()).toEqual([]);
    release.resolve();
    expect((await nextWrite).statusCode).toBe(201);

    await app.close();
    expect(readdirSync(remote.setsDir)).toEqual([expect.stringMatching(/^new-set-/)]);
  } finally {
    release.resolve();
    simulatedRead.before = null;
    await app.close();
    library.close();
    rmSync(root, { recursive: true, force: true });
  }
});
