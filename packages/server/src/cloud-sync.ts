/**
 * Bidirectional synchronization between the private working library and a folder
 * managed by a cloud desktop client (Google Drive, Dropbox, OneDrive, Nextcloud…).
 *
 * Only the human-readable Songs and Sets trees are mirrored. The rebuildable SQLite
 * index, WAL files and application settings deliberately stay local: synchronizing a
 * live database is both noisy and a reliable way to corrupt it after a conflict.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  inspectLibraryDirectory,
  prepareLibraryDirectory,
  type LibraryDirectory,
} from './data-directory.js';

const STATE_FILE = '.cloud-sync-state.json';
const CONFLICTS_FOLDER = 'Cloud Conflicts';

interface SyncState {
  version: 1;
  remoteRoot: string;
  files: Record<string, string>;
  updatedAt: string;
}

export interface CloudSyncResult {
  pushed: number;
  pulled: number;
  deletedLocally: number;
  deletedRemotely: number;
  unchanged: number;
  conflicts: { path: string; folder: string }[];
  syncedAt: string;
}

export interface CloudSyncStatus {
  configured: boolean;
  remoteRoot: string | null;
  lastSync: string | null;
  trackedFiles: number;
}

function hash(path: string): string | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function atomicCopy(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.worship-sync-${process.pid}-${Date.now()}`,
  );
  copyFileSync(source, temporary);
  renameSync(temporary, destination);
}

function statePath(localRoot: string): string {
  return join(localRoot, STATE_FILE);
}

function readState(localRoot: string, remoteRoot: string): SyncState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(localRoot), 'utf8')) as Partial<SyncState>;
    if (
      parsed.version === 1 &&
      resolve(parsed.remoteRoot ?? '') === resolve(remoteRoot) &&
      parsed.files &&
      typeof parsed.files === 'object'
    ) {
      return parsed as SyncState;
    }
  } catch {
    // A missing/corrupt state file is a first sync. No library file is ever discarded
    // merely because this small cache was lost.
  }
  return { version: 1, remoteRoot: resolve(remoteRoot), files: {}, updatedAt: '' };
}

function writeState(localRoot: string, state: SyncState): void {
  const path = statePath(localRoot);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
  renameSync(temporary, path);
}

function allowed(kind: 'Songs' | 'Sets', name: string): boolean {
  const extension = extname(name).toLocaleLowerCase('en');
  return kind === 'Songs' ? extension === '.chopro' : extension === '.json';
}

function collect(root: string, kind: 'Songs' | 'Sets'): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(root)) return files;
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && allowed(kind, entry.name)) {
        const name = relative(root, full).split(sep).join('/');
        files.set(`${kind}/${name}`, full);
      }
    }
  };
  walk(root);
  return files;
}

function libraryPath(layout: LibraryDirectory, path: string): string {
  const [kind, ...parts] = path.split('/');
  if (kind === 'Songs') return join(layout.songsDir, ...parts);
  if (kind === 'Sets') return join(layout.setsDir, ...parts);
  throw new Error(`Invalid synchronized library path: ${path}`);
}

function conflictFolder(localRoot: string, path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(localRoot, CONFLICTS_FOLDER, stamp, dirname(path));
}

function preserveConflict(
  localRoot: string,
  path: string,
  local: string | undefined,
  remote: string | undefined,
): string {
  const folder = conflictFolder(localRoot, path);
  mkdirSync(folder, { recursive: true });
  const name = basename(path);
  if (local && existsSync(local)) copyFileSync(local, join(folder, `${name}.local`));
  if (remote && existsSync(remote)) copyFileSync(remote, join(folder, `${name}.cloud`));
  writeFileSync(
    join(folder, `${name}.txt`),
    'Both copies changed since the last synchronization. Neither original was overwritten.\n',
    'utf8',
  );
  return folder;
}

/** Read-only status; safe to show even when the configured drive is disconnected. */
export function cloudSyncStatus(
  localRoot: string,
  remoteRoot?: string | null,
): CloudSyncStatus {
  if (!remoteRoot) {
    return { configured: false, remoteRoot: null, lastSync: null, trackedFiles: 0 };
  }
  const state = readState(localRoot, remoteRoot);
  return {
    configured: true,
    remoteRoot: resolve(remoteRoot),
    lastSync: state.updatedAt || null,
    trackedFiles: Object.keys(state.files).length,
  };
}

/**
 * Reconcile both folders without silently choosing a winner when both changed.
 *
 * Deletions propagate only when the remaining side still equals the last synchronized
 * copy. A delete racing an edit is a conflict, not permission to lose the edit.
 */
export function syncCloudFolder(localRoot: string, remoteRoot: string): CloudSyncResult {
  const local = inspectLibraryDirectory(localRoot);
  const remote = prepareLibraryDirectory(remoteRoot);
  const state = readState(local.root, remote.root);
  const localFiles = new Map([
    ...collect(local.songsDir, 'Songs'),
    ...collect(local.setsDir, 'Sets'),
  ]);
  const remoteFiles = new Map([
    ...collect(remote.songsDir, 'Songs'),
    ...collect(remote.setsDir, 'Sets'),
  ]);
  const paths = new Set([
    ...localFiles.keys(),
    ...remoteFiles.keys(),
    ...Object.keys(state.files),
  ]);
  const next: Record<string, string> = {};
  const result: CloudSyncResult = {
    pushed: 0,
    pulled: 0,
    deletedLocally: 0,
    deletedRemotely: 0,
    unchanged: 0,
    conflicts: [],
    syncedAt: new Date().toISOString(),
  };

  for (const path of [...paths].sort()) {
    const localPath = localFiles.get(path);
    const remotePath = remoteFiles.get(path);
    const localHash = localPath ? hash(localPath) : null;
    const remoteHash = remotePath ? hash(remotePath) : null;
    const base = state.files[path] ?? null;

    if (localHash === remoteHash) {
      if (localHash) next[path] = localHash;
      result.unchanged++;
      continue;
    }

    if (!base) {
      if (localPath && localHash && !remotePath) {
        const destination = libraryPath(remote, path);
        atomicCopy(localPath, destination);
        next[path] = localHash;
        result.pushed++;
        continue;
      }
      if (remotePath && remoteHash && !localPath) {
        const destination = libraryPath(local, path);
        atomicCopy(remotePath, destination);
        next[path] = remoteHash;
        result.pulled++;
        continue;
      }
    } else {
      if (localPath && localHash === base && remotePath && remoteHash) {
        atomicCopy(remotePath, localPath);
        next[path] = remoteHash;
        result.pulled++;
        continue;
      }
      if (remotePath && remoteHash === base && localPath && localHash) {
        atomicCopy(localPath, remotePath);
        next[path] = localHash;
        result.pushed++;
        continue;
      }
      if (!localPath && remotePath && remoteHash === base) {
        rmSync(remotePath, { force: true });
        result.deletedRemotely++;
        continue;
      }
      if (!remotePath && localPath && localHash === base) {
        rmSync(localPath, { force: true });
        result.deletedLocally++;
        continue;
      }
    }

    const folder = preserveConflict(local.root, path, localPath, remotePath);
    result.conflicts.push({ path, folder });
    if (base) next[path] = base;
  }

  writeState(local.root, {
    version: 1,
    remoteRoot: remote.root,
    files: next,
    updatedAt: result.syncedAt,
  });
  return result;
}
