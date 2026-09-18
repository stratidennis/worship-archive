/**
 * Prove the bundled server actually serves.
 *
 * Bundling Fastify is the one genuinely risky thing about the Electron build: its
 * plugin system reads function names and arity at registration time, and a bundler that
 * rewrites either produces an app that installs perfectly and then fails to start. That
 * failure would first appear on a laptop at a church, so it is a CI gate instead.
 *
 * This bundles `startServer` with the exact settings `bundle.mjs` uses, runs the result
 * under plain Node, and checks that the API answers.
 */

import { build } from 'esbuild';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The bundle has to live inside the package: `better-sqlite3` stays external, exactly
// as it does in the packaged app, so Node has to be able to resolve it from where the
// bundle sits. From a temp folder it cannot.
const work = resolve(root, '.smoke');
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const bundle = join(work, 'server.cjs');

await build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: false,
  logLevel: 'warning',
  external: ['better-sqlite3'],
  define: { 'process.env.NODE_ENV': '"production"' },
  entryPoints: [resolve(root, 'src/server-entry.ts')],
  outfile: bundle,
  // Resolve `better-sqlite3` from the desktop package, as the packaged app does.
  absWorkingDir: root,
});

const data = join(work, 'data');
await mkdir(join(data, 'songs'), { recursive: true });
await writeFile(
  join(data, 'songs', 'smoke.chopro'),
  '{title: Bunătatea Ta}\n{key: G}\n{x_id: smoke-1}\n\n{start_of_verse: V1}\nEu Te iu[G]besc\n{end_of_verse}\n',
  'utf8',
);

const { startServer } = await import(pathToFileURL(bundle).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/*
  A stand-in for the packaged interface.

  The point is not what is in the file but that a client-side route reaches it: every
  address a band member is ever given — `/band`, `/stage`, `/join` — is a path only the
  browser knows how to resolve, so the server has to answer all of them with the app.
  Without that, scanning the QR code gets you a JSON 404.
*/
const ui = join(data, 'ui');
await mkdir(ui, { recursive: true });
await writeFile(
  join(ui, 'index.html'),
  '<!doctype html><title>Worship Archive</title>',
  'utf8',
);

const server = await startServer({
  dataDir: data,
  uiDir: ui,
  port: 7999,
  mdns: false,
  watch: false,
  log: () => {},
});

try {
  const base = `http://127.0.0.1:${server.port}`;

  const stats = await (await fetch(`${base}/api/stats`)).json();
  check('the API answers', stats.songs === 1, `songs=${stats.songs}`);

  // The addresses on the join screen are these, and they are client-side routes.
  for (const route of ['/', '/band', '/stage', '/join', '/sets/anything']) {
    const page = await fetch(`${base}${route}`);
    const html = (page.headers.get('content-type') ?? '').includes('text/html');
    check(`${route} serves the app`, page.ok && html, `${page.status}`);
  }

  // ...and an unknown API route is still an API error, not the app.
  const missing = await fetch(`${base}/api/nope`);
  check('an unknown API route stays JSON', missing.status === 404);

  // SQLite through the bundle, including the FTS5 index and the Romanian tokeniser.
  const hits = await (await fetch(`${base}/api/search?q=bunatatea`)).json();
  check('search works, diacritics folded', hits.length === 1, `${hits.length} hits`);

  const songs = await (await fetch(`${base}/api/songs`)).json();
  const song = await (await fetch(`${base}/api/songs/${songs[0].id}`)).json();
  check('a song parses back out', song.blocks[0].lines[0].chords[0].raw === 'G');

  // The WebSocket hub upgrades on the same server; a bundled `ws` that cannot upgrade
  // would take the whole live session down.
  // Node's own global WebSocket, not `ws`: this checks that a *client* unrelated to the
  // bundle can upgrade against the bundled server, which is what a phone does.
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const frame = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('no session frame in 3s')), 3000);
    ws.addEventListener('message', (event) => {
      clearTimeout(timer);
      done(JSON.parse(String(event.data)));
    });
    ws.addEventListener('error', () => fail(new Error('websocket error')));
  });
  ws.close();
  check('the WebSocket hub sends state on connect', frame.t === 'session');

  const backup = await (await fetch(`${base}/api/backup`)).json();
  check('backup produces a restorable file', backup.songs.length === 1);
} finally {
  await server.stop();
  await rm(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — the bundled server is broken.`);
  process.exit(1);
}
console.log('\nthe bundled server works.');
