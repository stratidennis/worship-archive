import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library } from '../src/library.js';
import { SetStore } from '../src/sets.js';
import { backupFilename, createBackup, isBackup, restoreBackup, type Backup } from '../src/backup.js';

let dir: string;
let library: Library;
let sets: SetStore;

const SONG = (id: string, title: string) => `{title: ${title}}
{key: G}
{x_id: ${id}}

{start_of_verse: V1}
Vreau să cânt bunătatea [G]Ta
{end_of_verse}
`;

function writeSong(relPath: string, text: string): void {
  const full = join(dir, 'songs', relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text, 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-backup-'));
  library = new Library(dir);
  sets = new SetStore(dir, library.db);
});

afterEach(() => {
  library.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('making a backup', () => {
  it('captures the source text, not the parsed model', () => {
    // The point of the whole design: a backup restored in five years must not depend on
    // today's parser still existing in today's form.
    writeSong('a.chopro', SONG('id-a', 'Bunătatea Ta'));
    library.reindex();

    const backup = createBackup(library, sets);
    expect(backup.songs).toHaveLength(1);
    expect(backup.songs[0]!.text).toBe(SONG('id-a', 'Bunătatea Ta'));
    expect(backup.counts.songs).toBe(1);
  });

  it('keeps collection subfolders in the path', () => {
    writeSong(join('L&I', 'b.chopro'), SONG('id-b', 'A doua'));
    library.reindex();
    expect(createBackup(library, sets).songs[0]!.path).toBe('L&I/b.chopro');
  });

  it('includes sets', () => {
    sets.save({
      id: 'set-1',
      title: 'Duminică',
      date: '2026-01-04',
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rev: 0,
    });
    expect(createBackup(library, sets).sets).toHaveLength(1);
  });

  it('names the file so backups sort by date', () => {
    expect(backupFilename(new Date('2026-03-04T17:05:00Z'))).toBe(
      'worship-archive-2026-03-04-1705.json',
    );
  });
});

describe('recognising a backup file', () => {
  it('accepts its own output', () => {
    expect(isBackup(createBackup(library, sets))).toBe(true);
  });

  it('rejects anything else, rather than half-restoring it', () => {
    for (const bad of [null, {}, [], 'text', { format: 'something-else' }, { format: 'worship-archive-backup' }]) {
      expect(isBackup(bad)).toBe(false);
    }
  });
});

describe('restoring', () => {
  function backupOf(songs: { path: string; text: string }[]): Backup {
    return {
      format: 'worship-archive-backup',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      counts: { songs: songs.length, sets: 0 },
      songs,
      sets: [],
    };
  }

  it('writes the songs and reindexes, so they are searchable immediately', () => {
    const result = restoreBackup(library, sets, backupOf([
      { path: 'a.chopro', text: SONG('id-a', 'Bunătatea Ta') },
    ]));
    expect(result.songs).toBe(1);
    expect(library.stats().songs).toBe(1);
    expect(library.search('bunatatea')).toHaveLength(1);
  });

  it('merges by default, keeping songs the backup does not mention', () => {
    writeSong('existing.chopro', SONG('id-x', 'Deja aici'));
    library.reindex();

    restoreBackup(library, sets, backupOf([{ path: 'new.chopro', text: SONG('id-n', 'Nouă') }]));
    expect(library.stats().songs).toBe(2);
  });

  it('replaces only when asked, and says how much it removed', () => {
    writeSong('existing.chopro', SONG('id-x', 'Deja aici'));
    library.reindex();

    const result = restoreBackup(
      library,
      sets,
      backupOf([{ path: 'new.chopro', text: SONG('id-n', 'Nouă') }]),
      { mode: 'replace' },
    );
    expect(result.removed).toBe(1);
    expect(library.stats().songs).toBe(1);
    expect(existsSync(join(dir, 'songs', 'existing.chopro'))).toBe(false);
  });

  it('refuses a path that escapes the library folder', () => {
    // Backups are usually your own. "Usually" is not a security model.
    const result = restoreBackup(library, sets, backupOf([
      { path: '../../escaped.chopro', text: SONG('id-e', 'Nu') },
    ]));
    expect(result.songs).toBe(0);
    expect(result.skipped[0]!.error).toMatch(/escapes/);
    expect(existsSync(join(dir, '..', 'escaped.chopro'))).toBe(false);
  });

  it('round-trips a library byte for byte', () => {
    writeSong('a.chopro', SONG('id-a', 'Una'));
    writeSong(join('L&I', 'b.chopro'), SONG('id-b', 'Două'));
    library.reindex();
    const backup = createBackup(library, sets);

    rmSync(join(dir, 'songs'), { recursive: true, force: true });
    library.reindex();
    expect(library.stats().songs).toBe(0);

    restoreBackup(library, sets, backup);
    expect(library.stats().songs).toBe(2);
    expect(readFileSync(join(dir, 'songs', 'L&I', 'b.chopro'), 'utf8')).toBe(SONG('id-b', 'Două'));
  });
});
