/**
 * The on-disk library layout.
 *
 * Older Worship Archive installations use lowercase `songs` and `sets`. New folders
 * selected in the desktop app use the more human-facing `Songs` and `Sets`. Both are
 * valid, but having both variants on a case-sensitive disk is ambiguous and therefore
 * rejected instead of silently hiding half of the archive.
 */

import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface LibraryDirectory {
  root: string;
  songsDir: string;
  setsDir: string;
}

type FolderKind = 'songs' | 'sets';

function existingFolder(root: string, kind: FolderKind): string | null {
  if (!existsSync(root)) return null;
  const matches = readdirSync(root).filter((entry) => entry.toLocaleLowerCase() === kind);
  if (matches.length > 1) {
    throw new Error(
      `More than one ${kind} folder exists with different capitalisation. ` +
        'Keep one of them so Worship Archive knows which folder to use.',
    );
  }
  const name = matches[0];
  if (!name) return null;
  const path = join(root, name);
  if (!statSync(path).isDirectory()) throw new Error(`${path} exists but is not a folder.`);
  return path;
}

/** Inspect without changing anything on disk. */
export function inspectLibraryDirectory(root: string): LibraryDirectory {
  const absolute = resolve(root);
  if (existsSync(absolute) && !statSync(absolute).isDirectory()) {
    throw new Error(`${absolute} is not a folder.`);
  }
  return {
    root: absolute,
    songsDir: existingFolder(absolute, 'songs') ?? join(absolute, 'Songs'),
    setsDir: existingFolder(absolute, 'sets') ?? join(absolute, 'Sets'),
  };
}

/** Create a user-selected library root and verify that it is readable and writable. */
export function prepareLibraryDirectory(root: string): LibraryDirectory {
  const layout = inspectLibraryDirectory(root);
  mkdirSync(layout.root, { recursive: true });
  mkdirSync(layout.songsDir, { recursive: true });
  mkdirSync(layout.setsDir, { recursive: true });
  for (const path of [layout.root, layout.songsDir, layout.setsDir]) {
    accessSync(path, constants.R_OK | constants.W_OK);
  }
  return layout;
}

/** Server default: retain the historical lowercase layout unless a titled folder exists. */
export function resolveLibrarySubdirectory(root: string, kind: FolderKind): string {
  return existingFolder(resolve(root), kind) ?? join(resolve(root), kind);
}

export function libraryDirectoryIsEmpty(layout: LibraryDirectory): boolean {
  return [layout.songsDir, layout.setsDir].every(
    (path) => !existsSync(path) || readdirSync(path).length === 0,
  );
}

/** Copy source files into a new empty location, retaining the old folder as a backup. */
export function copyLibraryDirectory(
  source: LibraryDirectory,
  destination: LibraryDirectory,
): void {
  if (libraryDirectoriesOverlap(source, destination)) {
    throw new Error(
      'The new library folder cannot be inside the current Songs or Sets folder.',
    );
  }
  if (!libraryDirectoryIsEmpty(destination)) {
    throw new Error('The selected Songs or Sets folder is not empty.');
  }
  for (const [from, to] of [
    [source.songsDir, destination.songsDir],
    [source.setsDir, destination.setsDir],
  ] as const) {
    if (!existsSync(from)) continue;
    for (const entry of readdirSync(from)) {
      cpSync(join(from, entry), join(to, entry), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function libraryDirectoriesOverlap(a: LibraryDirectory, b: LibraryDirectory): boolean {
  const left = [a.songsDir, a.setsDir];
  const right = [b.songsDir, b.setsDir];
  return left.some((one) => right.some((two) => contains(one, two) || contains(two, one)));
}

export function sameLibraryDirectory(a: string, b: string): boolean {
  const left = existsSync(a) ? realpathSync(a) : resolve(a);
  const right = existsSync(b) ? realpathSync(b) : resolve(b);
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

export function hasLibraryFolders(root: string): boolean {
  try {
    const layout = inspectLibraryDirectory(root);
    return existsSync(layout.songsDir) || existsSync(layout.setsDir);
  } catch {
    return false;
  }
}
