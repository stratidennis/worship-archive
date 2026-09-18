/**
 * Bundle the main and preload processes.
 *
 * Everything is bundled into two files, with one exception: `better-sqlite3`, which is
 * a native addon and cannot be. That choice is what makes the packaged app immune to
 * pnpm's symlinked `node_modules` — electron-builder never has to work out which of
 * several hundred store paths belong in the asar, because there is nothing to collect.
 *
 * Not minified, deliberately. Fastify and its plugin system read `fn.name` and function
 * arity at registration time, and a mangled name there fails at startup with an error
 * that points nowhere near the cause.
 */

import { build } from 'esbuild';
import { rm, mkdir, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  // Electron 39 ships Node 22; nothing here needs downlevelling below that.
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  external: ['electron', 'better-sqlite3'],
  define: { 'process.env.NODE_ENV': '"production"' },
};

await build({
  ...common,
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(out, 'main.cjs'),
});

await build({
  ...common,
  entryPoints: [resolve(root, 'src/preload.ts')],
  outfile: resolve(out, 'preload.cjs'),
});

// Icons live next to the bundle so `__dirname` finds them identically in development
// and inside the packaged asar. electron-builder treats a top-level `build/` as its own
// resources folder and excludes it from the app, so it cannot be referenced from there.
await cp(resolve(root, 'build'), resolve(out, 'build'), { recursive: true });

// The built UI is served by the embedded Fastify, so it ships as plain files next to
// the bundle rather than being loaded from disk by the renderer.
const ui = resolve(root, '../ui/dist');
await cp(ui, resolve(out, 'ui'), { recursive: true }).catch(() => {
  console.warn('  no built UI at packages/ui/dist — run `pnpm --filter @worship/ui build` first');
});

console.log('  bundled to packages/desktop/dist');
