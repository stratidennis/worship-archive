/**
 * Switch `better-sqlite3` between the Node and Electron ABIs.
 *
 * There is exactly one copy of the compiled addon in the pnpm store, and Node and
 * Electron want different ABI versions of it. Running `electron .` therefore breaks
 * `pnpm test`, and rebuilding for tests breaks `electron .` — an unpleasant surprise
 * the first time, and a five-second fix once you know.
 *
 *   node tools/src/native-abi.mjs node        # before running the tests
 *   node tools/src/native-abi.mjs electron    # before running the desktop app
 *   node tools/src/native-abi.mjs             # just report which one is installed
 *
 * CI never needs this: the test job and the packaging job are separate machines.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2];

// There is exactly one copy of the addon, in the pnpm store, and both toolchains
// rewrite it in place.
const store = join(root, 'node_modules/.pnpm');
const pkg = readdirSync(store).find((entry) => /^better-sqlite3@/.test(entry));
if (!pkg) {
  console.error('better-sqlite3 is not installed; run `pnpm install` first');
  process.exit(1);
}
const modulePath = join(store, pkg, 'node_modules/better-sqlite3');

/**
 * Which ABI is actually installed right now.
 *
 * Opening a database rather than requiring the module: better-sqlite3 loads its addon
 * lazily, so a bare `require` succeeds against a binary that cannot possibly work. That
 * detail is what makes this failure mode so confusing, and it is worth checking properly
 * — the alternative is a packaged app that only reveals the problem on launch.
 */
function currentAbi() {
  const require = createRequire(join(root, 'packages/server/index.js'));
  try {
    const Database = require('better-sqlite3');
    new Database(':memory:').close();
    return { runtime: 'node', detail: `Node ABI ${process.versions.modules}` };
  } catch (error) {
    const found = /NODE_MODULE_VERSION (\d+)/.exec(String(error.message));
    return {
      runtime: found ? 'other' : 'broken',
      detail: found ? `ABI ${found[1]} — not this Node` : String(error.message).split('\n')[0],
    };
  }
}

if (target === undefined) {
  const { runtime, detail } = currentAbi();
  console.log(
    runtime === 'node'
      ? `better-sqlite3 matches Node (${detail}) — tests will run, \`electron .\` will not.`
      : `better-sqlite3 does not match Node (${detail}) — \`electron .\` will run, tests will not.`,
  );
  process.exit(0);
}

if (target !== 'node' && target !== 'electron') {
  console.error('usage: node tools/src/native-abi.mjs [node|electron]');
  process.exit(2);
}

if (target === 'electron') {
  execFileSync(
    'pnpm',
    ['--filter', '@worship/desktop', 'exec', 'electron-builder', 'install-app-deps'],
    { cwd: root, stdio: 'inherit' },
  );
  const { runtime, detail } = currentAbi();
  if (runtime === 'node') {
    console.error(
      `\nThe rebuild reported success but left the Node build in place (${detail}).\n` +
        'Delete node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3/build and try again.',
    );
    process.exit(1);
  }
  console.log(
    `\nbetter-sqlite3 now matches Electron (${detail}). \`pnpm test\` will fail until you switch back.`,
  );
  process.exit(0);
}

/*
  Remove @electron/rebuild's marker along with the binary.

  `.forge-meta` records "this was built for Electron <abi>", and @electron/rebuild skips
  the rebuild entirely when it matches. Replacing the binary and leaving the marker makes
  it a lie: the next switch back to Electron reports "finished", changes nothing, and
  produces an installer whose app dies on launch with NODE_MODULE_VERSION. Nothing warns
  you — the packaging log is identical either way.
*/
rmSync(join(modulePath, 'build/Release/.forge-meta'), { force: true });

// pnpm's own `rebuild` is a no-op here — the package is already marked built — so the
// prebuild is fetched directly, in the store directory where the addon actually lives.
const prebuildDir = readdirSync(store).find((entry) => /^prebuild-install@/.test(entry));
const bin = prebuildDir && join(store, prebuildDir, 'node_modules/prebuild-install/bin.js');
if (!bin || !existsSync(bin)) {
  console.error('prebuild-install is not available; run `pnpm install` first');
  process.exit(1);
}

execFileSync(process.execPath, [bin, '--runtime=node'], { cwd: modulePath, stdio: 'inherit' });

const { runtime, detail } = currentAbi();
if (runtime !== 'node') {
  console.error(`\nStill not the Node build (${detail}).`);
  process.exit(1);
}
console.log(
  `\nbetter-sqlite3 now matches Node (${detail}). \`electron .\` will fail until you switch back.`,
);
