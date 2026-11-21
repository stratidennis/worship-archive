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
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  inspectLibraryDirectoryAsync,
  prepareLibraryDirectoryAsync,
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

export type CloudTaskQueue = <Result>(task: () => Result | Promise<Result>) => Promise<Result>;

export function createCloudTaskQueue(): CloudTaskQueue {
  let pending = Promise.resolve();
  return (task) => {
    const next = pending.then(task);
    pending = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

async function hash(path: string): Promise<string | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicCopy(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.worship-sync-${process.pid}-${Date.now()}`,
  );
  await copyFile(source, temporary);
  await rename(temporary, destination);
}

function statePath(localRoot: string): string {
  return join(localRoot, STATE_FILE);
}

async function readState(localRoot: string, remoteRoot: string): Promise<SyncState> {
  try {
    const parsed = JSON.parse(
      await readFile(statePath(localRoot), 'utf8'),
    ) as Partial<SyncState>;
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

async function writeState(localRoot: string, state: SyncState): Promise<void> {
  const path = statePath(localRoot);
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await rename(temporary, path);
}

function allowed(kind: 'Songs' | 'Sets', name: string): boolean {
  const extension = extname(name).toLocaleLowerCase('en');
  return kind === 'Songs' ? extension === '.chopro' : extension === '.json';
}

async function collect(root: string, kind: 'Songs' | 'Sets'): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && allowed(kind, entry.name)) {
        const name = relative(root, full).split(sep).join('/');
        files.set(`${kind}/${name}`, full);
      }
    }
  };
  await walk(root);
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

async function preserveConflict(
  localRoot: string,
  path: string,
  local: string | undefined,
  remote: string | undefined,
): Promise<string> {
  const folder = conflictFolder(localRoot, path);
  await mkdir(folder, { recursive: true });
  const name = basename(path);
  if (local) await copyFile(local, join(folder, `${name}.local`));
  if (remote) await copyFile(remote, join(folder, `${name}.cloud`));
  await writeFile(
    join(folder, `${name}.txt`),
    'Both copies changed since the last synchronization. Neither original was overwritten.\n',
    'utf8',
  );
  return folder;
}

/** Read-only status; safe to show even when the configured drive is disconnected. */
export async function cloudSyncStatus(
  localRoot: string,
  remoteRoot?: string | null,
): Promise<CloudSyncStatus> {
  if (!remoteRoot) {
    return { configured: false, remoteRoot: null, lastSync: null, trackedFiles: 0 };
  }
  const state = await readState(localRoot, remoteRoot);
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
export async function syncCloudFolder(
  localRoot: string,
  remoteRoot: string,
): Promise<CloudSyncResult> {
  const local = await inspectLibraryDirectoryAsync(localRoot);
  const remote = await prepareLibraryDirectoryAsync(remoteRoot);
  const state = await readState(local.root, remote.root);
  const localFiles = new Map([
    ...(await collect(local.songsDir, 'Songs')),
    ...(await collect(local.setsDir, 'Sets')),
  ]);
  const remoteFiles = new Map([
    ...(await collect(remote.songsDir, 'Songs')),
    ...(await collect(remote.setsDir, 'Sets')),
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
    const [localHash, remoteHash] = await Promise.all([
      localPath ? hash(localPath) : null,
      remotePath ? hash(remotePath) : null,
    ]);
    const base = state.files[path] ?? null;

    if (localHash === remoteHash) {
      if (localHash) next[path] = localHash;
      result.unchanged++;
      continue;
    }

    if (!base) {
      if (localPath && localHash && !remotePath) {
        const destination = libraryPath(remote, path);
        await atomicCopy(localPath, destination);
        next[path] = localHash;
        result.pushed++;
        continue;
      }
      if (remotePath && remoteHash && !localPath) {
        const destination = libraryPath(local, path);
        await atomicCopy(remotePath, destination);
        next[path] = remoteHash;
        result.pulled++;
        continue;
      }
    } else {
      if (localPath && localHash === base && remotePath && remoteHash) {
        await atomicCopy(remotePath, localPath);
        next[path] = remoteHash;
        result.pulled++;
        continue;
      }
      if (remotePath && remoteHash === base && localPath && localHash) {
        await atomicCopy(localPath, remotePath);
        next[path] = localHash;
        result.pushed++;
        continue;
      }
      if (!localPath && remotePath && remoteHash === base) {
        await rm(remotePath, { force: true });
        result.deletedRemotely++;
        continue;
      }
      if (!remotePath && localPath && localHash === base) {
        await rm(localPath, { force: true });
        result.deletedLocally++;
        continue;
      }
    }

    const folder = await preserveConflict(
      local.root,
      path,
      localHash ? localPath : undefined,
      remoteHash ? remotePath : undefined,
    );
    result.conflicts.push({ path, folder });
    if (base) next[path] = base;
  }

  await writeState(local.root, {
    version: 1,
    remoteRoot: remote.root,
    files: next,
    updatedAt: result.syncedAt,
  });
  return result;
}
