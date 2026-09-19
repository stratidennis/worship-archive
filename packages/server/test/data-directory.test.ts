import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  copyLibraryDirectory,
  hasLibraryFolders,
  inspectLibraryDirectory,
  prepareLibraryDirectory,
  resolveLibrarySubdirectory,
} from '../src/data-directory.js';

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'worship-location-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('library folder locations', () => {
  it('keeps the lowercase folders used by existing installations', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'songs'));
    mkdirSync(join(root, 'sets'));

    expect(basename(resolveLibrarySubdirectory(root, 'songs'))).toBe('songs');
    expect(basename(resolveLibrarySubdirectory(root, 'sets'))).toBe('sets');
  });

  it('recognises user-facing Songs and Sets folders', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'Songs'));
    mkdirSync(join(root, 'Sets'));

    const layout = inspectLibraryDirectory(root);
    expect(basename(layout.songsDir)).toBe('Songs');
    expect(basename(layout.setsDir)).toBe('Sets');
    expect(hasLibraryFolders(root)).toBe(true);
  });

  it('creates both subfolders in a newly selected root', () => {
    const root = temporaryRoot();
    const layout = prepareLibraryDirectory(join(root, 'Archive'));

    expect(layout.root).toBe(join(root, 'Archive'));
    expect(existsSync(join(root, 'Archive', 'Songs'))).toBe(true);
    expect(existsSync(join(root, 'Archive', 'Sets'))).toBe(true);
  });

  it('copies songs and sets into an empty destination without changing the source', () => {
    const source = prepareLibraryDirectory(join(temporaryRoot(), 'Source'));
    const destination = prepareLibraryDirectory(join(temporaryRoot(), 'Destination'));
    mkdirSync(join(source.songsDir, 'Worship'));
    writeFileSync(join(source.songsDir, 'Worship', 'song.chopro'), '{title: Song}', 'utf8');
    writeFileSync(join(source.setsDir, 'sunday.json'), '{"title":"Sunday"}', 'utf8');

    copyLibraryDirectory(source, destination);

    expect(readFileSync(join(destination.songsDir, 'Worship', 'song.chopro'), 'utf8')).toBe(
      '{title: Song}',
    );
    expect(readFileSync(join(destination.setsDir, 'sunday.json'), 'utf8')).toBe(
      '{"title":"Sunday"}',
    );
    expect(existsSync(join(source.songsDir, 'Worship', 'song.chopro'))).toBe(true);
  });
});
