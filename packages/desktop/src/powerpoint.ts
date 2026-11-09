/** Launch presentation files in a desktop editor before falling back to the OS default. */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, win32 } from 'node:path';
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

export function windowsOnlyOfficeCandidates(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const roots = [
    environment['LOCALAPPDATA'],
    environment['ProgramW6432'],
    environment['ProgramFiles'],
    environment['ProgramFiles(x86)'],
  ].filter((value): value is string => Boolean(value));
  return [
    ...new Set(
      roots.map((root) =>
        win32.join(root, 'ONLYOFFICE', 'DesktopEditors', 'DesktopEditors.exe'),
      ),
    ),
  ];
}

export function macOnlyOfficeCandidates(home = homedir()): string[] {
  return [
    '/Applications/ONLYOFFICE.app/Contents/MacOS/ONLYOFFICE',
    `${home}/Applications/ONLYOFFICE.app/Contents/MacOS/ONLYOFFICE`,
  ];
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

async function windowsOnlyOfficePath(): Promise<string | null> {
  const keys = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\DesktopEditors.exe',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\DesktopEditors.exe',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\DesktopEditors.exe',
  ];
  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key, '/ve'], {
        windowsHide: true,
      });
      const found = executablePathFromRegistry(stdout, 'DesktopEditors.exe');
      if (found && existsSync(found)) return found;
    } catch {
      // The app can be installed without an App Paths entry.
    }
  }
  return windowsOnlyOfficeCandidates().find(existsSync) ?? null;
}

export function executablePathFromRegistry(output: string, executable: string): string | null {
  const line = output
    .split(/\r?\n/)
    .find(
      (value) =>
        value.includes('REG_SZ') && value.toLowerCase().includes(executable.toLowerCase()),
    );
  if (!line) return null;
  const value =
    line
      .split(/REG_SZ/i)[1]
      ?.trim()
      .replace(/^"|"$/g, '') ?? '';
  return value.toLowerCase().endsWith(executable.toLowerCase()) ? value : null;
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

export async function openInOnlyOffice(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('/usr/bin/open', ['-a', 'ONLYOFFICE', ...paths]);
      return;
    } catch {
      // Launch Services may not have registered an otherwise usable app bundle.
      for (const executable of macOnlyOfficeCandidates()) {
        if (!existsSync(executable)) continue;
        try {
          await spawnDetached(executable, paths);
          return;
        } catch {
          // Try another installation before falling back to the file association.
        }
      }
      throw new Error('ONLYOFFICE is not installed or could not be opened.');
    }
  }
  if (process.platform === 'win32') {
    const executable = await windowsOnlyOfficePath();
    if (!executable) throw new Error('ONLYOFFICE is not installed.');
    await spawnDetached(executable, paths);
    return;
  }
  throw new Error('ONLYOFFICE launch is supported on Windows and macOS.');
}

export function preferredPresentationApps(paths: string[]): Array<'powerpoint' | 'onlyoffice'> {
  const extensions = paths.map((path) => extname(path).toLocaleLowerCase('en'));
  // Keynote files need their registered app. These formats are supported by
  // ONLYOFFICE, but cannot reliably be opened by Microsoft PowerPoint.
  if (extensions.includes('.key')) return [];
  if (
    extensions.some((extension) =>
      ['.dps', '.dpt', '.fodp', '.otp', '.sxi'].includes(extension),
    )
  ) {
    return ['onlyoffice'];
  }
  return ['powerpoint', 'onlyoffice'];
}

/** The caller uses the system file association if no preferred editor can launch. */
export async function openInPresentationApp(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const preferred = preferredPresentationApps(paths);
  if (preferred.length === 0) throw new Error('Open with the default presentation app.');
  if (preferred[0] === 'onlyoffice') {
    await openInOnlyOffice(paths);
    return;
  }
  try {
    await openInMicrosoftPowerPoint(paths);
  } catch {
    await openInOnlyOffice(paths);
  }
}
