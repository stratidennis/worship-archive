/**
 * Backup and restore.
 *
 * One JSON file holding the *source text* of every song and set — not the parsed model.
 * That choice matters: a backup made today must still restore in five years, when the
 * parser has moved on, and ChordPro text is the only thing here guaranteed to survive
 * that. It is also readable in any text editor, which is what you want at the moment
 * you actually need a backup.
 *
 * No zip, deliberately. The whole library is well under a megabyte, and a plain JSON
 * file needs no tool, no dependency and no format negotiation to open.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import type { Library } from './library.js';
import type { SetStore } from './sets.js';

export const BACKUP_FORMAT = 'worship-archive-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  /** Relative to the songs or sets folder, so collection subfolders survive. */
  path: string;
  text: string;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  /** For the human reading the file, and for a "are you sure?" before restoring. */
  counts: { songs: number; sets: number };
  songs: BackupFile[];
  sets: BackupFile[];
}

export interface RestoreResult {
  songs: number;
  sets: number;
  /** Files that were in the library and not in the backup, when replacing. */
  removed: number;
  skipped: { path: string; error: string }[];
}

/** Every file under `dir` with one of these extensions, as `{ path, text }`. */
function collect(dir: string, extensions: string[]): BackupFile[] {
  if (!existsSync(dir)) return [];
  const out: BackupFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry.startsWith('.')) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extensions.includes(extname(entry).toLowerCase())) {
        out.push({ path: relative(dir, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function createBackup(library: Library, sets: SetStore): Backup {
  const songFiles = collect(library.songsDir, ['.chopro', '.cho', '.chordpro', '.pro']);
  const setFiles = collect(sets.setsDir, ['.json']);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    counts: { songs: songFiles.length, sets: setFiles.length },
    songs: songFiles,
    sets: setFiles,
  };
}

/** A filename for the downloaded backup, sortable and unambiguous. */
export function backupFilename(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  return `worship-archive-${stamp}.json`;
}

export function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Backup>;
  return (
    candidate.format === BACKUP_FORMAT &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.songs) &&
    Array.isArray(candidate.sets)
  );
}

/**
 * A path from a backup file is untrusted input.
 *
 * `../../.ssh/authorized_keys` in a `path` would otherwise write outside the library.
 * Backups are usually your own, but "usually" is not a security model, and the cost of
 * checking is one function.
 */
function safeJoin(root: string, candidate: string): string | null {
  const full = join(root, candidate);
  const rel = relative(root, full);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) return null;
  return full;
}

export interface RestoreOptions {
  /**
   * `replace` deletes anything not in the backup; `merge` only adds and overwrites.
   *
   * Merge is the default because it cannot lose a song, and someone restoring a backup
   * is usually already having a bad day.
   */
  mode?: 'merge' | 'replace';
}

export function restoreBackup(
  library: Library,
  sets: SetStore,
  backup: Backup,
  options: RestoreOptions = {},
): RestoreResult {
  const mode = options.mode ?? 'merge';
  const skipped: { path: string; error: string }[] = [];
  let removed = 0;

  const write = (root: string, files: BackupFile[], extensions: string[]): number => {
    const keep = new Set<string>();
    let written = 0;
    for (const file of files) {
      const full = safeJoin(root, file.path);
      if (!full) {
        skipped.push({ path: file.path, error: 'path escapes the library folder' });
        continue;
      }
      if (typeof file.text !== 'string') {
        skipped.push({ path: file.path, error: 'no text' });
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.text, 'utf8');
      keep.add(relative(root, full).split(sep).join('/'));
      written++;
    }
    if (mode === 'replace') {
      for (const existing of collect(root, extensions)) {
        if (keep.has(existing.path)) continue;
        rmSync(join(root, existing.path), { force: true });
        removed++;
      }
    }
    return written;
  };

  mkdirSync(library.songsDir, { recursive: true });
  mkdirSync(sets.setsDir, { recursive: true });
  const songs = write(library.songsDir, backup.songs, ['.chopro', '.cho', '.chordpro', '.pro']);
  const setCount = write(sets.setsDir, backup.sets, ['.json']);

  // The files are the database; the index has to catch up before anyone reads it.
  library.reindex();
  sets.reindex();

  return { songs, sets: setCount, removed, skipped };
}
