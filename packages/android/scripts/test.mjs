import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'build'), { recursive: true });
const output = mkdtempSync(join(root, 'build/test-'));
execFileSync(
  'javac',
  [
    '--release',
    '8',
    '-encoding',
    'UTF-8',
    '-d',
    output,
    join(root, 'src/com/worshiparchive/band/LeaderEndpoint.java'),
    join(root, 'src/com/worshiparchive/band/LocalBandServer.java'),
    join(root, 'test/NativeCoreTest.java'),
  ],
  { stdio: 'inherit' },
);
execFileSync('java', ['-cp', output, 'com.worshiparchive.band.NativeCoreTest'], {
  stdio: 'inherit',
});
