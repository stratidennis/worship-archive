import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareLibraryDirectory } from '../src/data-directory.js';
import { cloudSyncStatus, syncCloudFolder } from '../src/cloud-sync.js';

const roots: string[] = [];

function root(name: string): string {
  const value = mkdtempSync(join(tmpdir(), `worship-${name}-`));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('cloud folder sync', () => {
  it('pushes and pulls new files while preserving song subfolders', () => {
    const local = prepareLibraryDirectory(root('local'));
    const remote = prepareLibraryDirectory(root('remote'));
    const youth = join(local.songsDir, 'Youth');
    mkdirSync(youth, { recursive: true });
    writeFileSync(join(youth, 'hope.chopro'), 'local song');
    writeFileSync(join(remote.setsDir, 'sunday.json'), '{"title":"Sunday"}');

    const result = syncCloudFolder(local.root, remote.root);

    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(1);
    expect(readFileSync(join(remote.songsDir, 'Youth', 'hope.chopro'), 'utf8')).toBe(
      'local song',
    );
    expect(readFileSync(join(local.setsDir, 'sunday.json'), 'utf8')).toBe('{"title":"Sunday"}');
    expect(cloudSyncStatus(local.root, remote.root).trackedFiles).toBe(2);
  });

  it('propagates edits and deletions after a common synchronized base', () => {
    const local = prepareLibraryDirectory(root('local'));
    const remote = prepareLibraryDirectory(root('remote'));
    const localSong = join(local.songsDir, 'song.chopro');
    const remoteSong = join(remote.songsDir, 'song.chopro');
    writeFileSync(localSong, 'one');
    syncCloudFolder(local.root, remote.root);

    writeFileSync(remoteSong, 'two');
    const pulled = syncCloudFolder(local.root, remote.root);
    expect(pulled.pulled).toBe(1);
    expect(readFileSync(localSong, 'utf8')).toBe('two');

    rmSync(localSong);
    const deleted = syncCloudFolder(local.root, remote.root);
    expect(deleted.deletedRemotely).toBe(1);
    expect(cloudSyncStatus(local.root, remote.root).trackedFiles).toBe(0);
  });

  it('never overwrites either side when both copies changed', () => {
    const local = prepareLibraryDirectory(root('local'));
    const remote = prepareLibraryDirectory(root('remote'));
    const localSong = join(local.songsDir, 'song.chopro');
    const remoteSong = join(remote.songsDir, 'song.chopro');
    writeFileSync(localSong, 'base');
    syncCloudFolder(local.root, remote.root);
    writeFileSync(localSong, 'local edit');
    writeFileSync(remoteSong, 'cloud edit');

    const result = syncCloudFolder(local.root, remote.root);

    expect(result.conflicts).toHaveLength(1);
    expect(readFileSync(localSong, 'utf8')).toBe('local edit');
    expect(readFileSync(remoteSong, 'utf8')).toBe('cloud edit');
    const folder = result.conflicts[0]!.folder;
    expect(readFileSync(join(folder, 'song.chopro.local'), 'utf8')).toBe('local edit');
    expect(readFileSync(join(folder, 'song.chopro.cloud'), 'utf8')).toBe('cloud edit');
  });

  it('treats two different pre-existing copies as a first-sync conflict', () => {
    const local = prepareLibraryDirectory(root('local'));
    const remote = prepareLibraryDirectory(root('remote'));
    writeFileSync(join(local.setsDir, 'set.json'), 'local');
    writeFileSync(join(remote.setsDir, 'set.json'), 'remote');

    const result = syncCloudFolder(local.root, remote.root);

    expect(result.conflicts.map((item) => item.path)).toEqual(['Sets/set.json']);
    expect(readFileSync(join(local.setsDir, 'set.json'), 'utf8')).toBe('local');
    expect(readFileSync(join(remote.setsDir, 'set.json'), 'utf8')).toBe('remote');
  });
});
