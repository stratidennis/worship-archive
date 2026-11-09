import { describe, expect, it } from 'vitest';
import {
  executablePathFromRegistry,
  macOnlyOfficeCandidates,
  powerPointPathFromRegistry,
  windowsOnlyOfficeCandidates,
  windowsPowerPointCandidates,
} from '../src/powerpoint.js';

describe('locating Microsoft PowerPoint on Windows', () => {
  it('reads the registered executable path', () => {
    expect(
      powerPointPathFromRegistry(`
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE
    (Default)    REG_SZ    C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE
`),
    ).toBe('C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE');
  });

  it('checks both modern Office architectures without duplicate paths', () => {
    const paths = windowsPowerPointCandidates({
      ProgramW6432: 'C:\\Program Files',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    });
    expect(paths).toContain(
      'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
    );
    expect(paths).toContain(
      'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
    );
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('locating ONLYOFFICE on Windows', () => {
  it('finds per-user and both system installation locations', () => {
    const paths = windowsOnlyOfficeCandidates({
      LOCALAPPDATA: 'C:\\Users\\Singer\\AppData\\Local',
      ProgramW6432: 'C:\\Program Files',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    });
    expect(paths).toContain(
      'C:\\Users\\Singer\\AppData\\Local\\ONLYOFFICE\\DesktopEditors\\DesktopEditors.exe',
    );
    expect(paths).toContain(
      'C:\\Program Files\\ONLYOFFICE\\DesktopEditors\\DesktopEditors.exe',
    );
    expect(paths).toContain(
      'C:\\Program Files (x86)\\ONLYOFFICE\\DesktopEditors\\DesktopEditors.exe',
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('reads an app path registered with Windows', () => {
    expect(
      executablePathFromRegistry(
        '    (Default)    REG_SZ    C:\\Program Files\\ONLYOFFICE\\DesktopEditors\\DesktopEditors.exe\r\n',
        'DesktopEditors.exe',
      ),
    ).toBe('C:\\Program Files\\ONLYOFFICE\\DesktopEditors\\DesktopEditors.exe');
  });
});

describe('locating ONLYOFFICE on macOS', () => {
  it('checks system and per-user app bundles when Launch Services has no entry', () => {
    expect(macOnlyOfficeCandidates('/Users/singer')).toEqual([
      '/Applications/ONLYOFFICE.app/Contents/MacOS/ONLYOFFICE',
      '/Users/singer/Applications/ONLYOFFICE.app/Contents/MacOS/ONLYOFFICE',
    ]);
  });
});
