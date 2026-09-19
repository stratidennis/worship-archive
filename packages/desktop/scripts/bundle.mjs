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
const roleIndex = process.argv.indexOf('--role');
const role = roleIndex >= 0 ? process.argv[roleIndex + 1] : 'leader';
if (!['leader', 'band', 'stage'].includes(role)) {
  throw new Error(`Unknown desktop role: ${role}`);
}
const productName =
  role === 'leader'
    ? 'Worship Archive Leader'
    : role === 'band'
      ? 'Worship Archive Band'
      : 'Worship Archive Stage';

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
  define: {
    'process.env.NODE_ENV': '"production"',
    __WORSHIP_DESKTOP_ROLE__: JSON.stringify(role),
    __WORSHIP_PRODUCT_NAME__: JSON.stringify(productName),
  },
};

await build({
  ...common,
  entryPoints: [resolve(root, role === 'leader' ? 'src/main.ts' : 'src/client-main.ts')],
  outfile: resolve(out, 'main.cjs'),
});

await build({
  ...common,
  entryPoints: [resolve(root, role === 'leader' ? 'src/preload.ts' : 'src/client-preload.ts')],
  outfile: resolve(out, role === 'leader' ? 'preload.cjs' : 'client-preload.cjs'),
});

// Icons live next to the bundle so `__dirname` finds them identically in development
// and inside the packaged asar. electron-builder treats a top-level `build/` as its own
// resources folder and excludes it from the app, so it cannot be referenced from there.
await cp(resolve(root, 'build'), resolve(out, 'build'), { recursive: true });

// The built UI is served by the embedded Fastify, so it ships as plain files next to
// the bundle rather than being loaded from disk by the renderer.
const ui = resolve(root, '../ui/dist');
await cp(ui, resolve(out, 'ui'), { recursive: true }).catch(() => {
  console.warn(
    '  no built UI at packages/ui/dist — run `pnpm --filter @worship/ui build` first',
  );
});

console.log(`  bundled ${productName} to packages/desktop/dist`);
