import { describe, expect, it } from 'vitest';
import { powerPointPathFromRegistry, windowsPowerPointCandidates } from '../src/powerpoint.js';

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
