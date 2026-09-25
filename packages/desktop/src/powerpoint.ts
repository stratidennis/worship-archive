/** Prefer Microsoft PowerPoint while allowing callers to fall back to the default app. */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function windowsPowerPointCandidates(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const roots = [
    environment['ProgramW6432'],
    environment['ProgramFiles'],
    environment['ProgramFiles(x86)'],
  ].filter((value): value is string => Boolean(value));
  const candidates = new Set<string>();
  for (const root of roots) {
    for (const version of ['Office16', 'Office15', 'Office14']) {
      candidates.add(win32.join(root, 'Microsoft Office', 'root', version, 'POWERPNT.EXE'));
      candidates.add(win32.join(root, 'Microsoft Office', version, 'POWERPNT.EXE'));
    }
  }
  return [...candidates];
}

export function powerPointPathFromRegistry(output: string): string | null {
  const match = /REG_SZ\s+([^\r\n]*POWERPNT\.EXE)\s*$/im.exec(output);
  return match?.[1]?.trim().replace(/^"|"$/g, '') ?? null;
}

async function windowsPowerPointPath(): Promise<string | null> {
  const keys = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE',
  ];
  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key, '/ve'], {
        windowsHide: true,
      });
      const found = powerPointPathFromRegistry(stdout);
      if (found && existsSync(found)) return found;
    } catch {
      // A missing registry key is normal; Office may use a different architecture.
    }
  }
  return windowsPowerPointCandidates().find(existsSync) ?? null;
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Launch every file in one PowerPoint instance.
 *
 * Microsoft documents `/O` as the Windows switch for opening a list of presentations.
 * On macOS, `open -a` names the application explicitly and fails when it is absent.
 * The caller catches that failure and opens the files with the OS default instead.
 */
export async function openInMicrosoftPowerPoint(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('/usr/bin/open', ['-a', 'Microsoft PowerPoint', ...paths]);
      return;
    } catch {
      throw new Error('Microsoft PowerPoint is not installed or could not be opened.');
    }
  }
  if (process.platform === 'win32') {
    const executable = await windowsPowerPointPath();
    if (!executable) throw new Error('Microsoft PowerPoint is not installed.');
    try {
      await spawnDetached(executable, ['/O', ...paths]);
      return;
    } catch {
      throw new Error('Microsoft PowerPoint could not be opened.');
    }
  }
  throw new Error('Opening Microsoft PowerPoint is supported on Windows and macOS.');
}
