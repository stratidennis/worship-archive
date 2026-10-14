/** CI emulator only: never silently install an APK on a person's connected phone. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_SESSION } from '../../core/src/session.ts';
import {
  center,
  createHierarchyReader,
  focusInput,
  nativeInputs,
  waitFor,
} from './smoke-ui.mjs';

if (!process.argv.includes('--emulator'))
  throw new Error(
    'This test requires explicit --emulator; it must not install on a physical device.',
  );
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adb = (...args) =>
  execFileSync('adb', ['-e', ...args], { encoding: 'utf8', timeout: 30000 });
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));
const { WebSocketServer } = createRequire(
  new URL('../../server/package.json', import.meta.url),
)('ws');
const song = {
  id: 'android-smoke-song',
  title: 'Android Band smoke test',
  legacyUuid: null,
  writtenKey: 'G',
  performanceKey: 'G',
  tempo: null,
  timeSignature: null,
  authors: [],
  copyright: null,
  ccli: null,
  tags: [],
  collectionIds: [],
  arrangement: null,
  lang: null,
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
  rev: 1,
  blocks: Array.from({ length: 4 }, (_, i) => ({
    id: `V${i}`,
    type: 'Verse',
    label: null,
    repeat: null,
    singers: null,
    linkToPrevious: false,
    lines: [
      'Android live connection works',
      'The whole Band screen is available',
      'Rotate without losing the song',
      'Settings remain on this device',
    ].map((text) => ({
      text,
      chords: [{ at: 0, raw: 'G' }],
      bass: [],
      indent: 0,
      color: null,
    })),
  })),
};
const set = {
  id: 'android-smoke-set',
  title: 'APK test',
  date: null,
  items: [{ kind: 'song', songId: song.id }],
  createdAt: song.createdAt,
  updatedAt: song.updatedAt,
};
const state = { ...INITIAL_SESSION, active: true, setId: set.id, rev: 1 };
const requests = [];
const backend = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url });
  response.setHeader('content-type', 'application/json');
  const path = new URL(request.url, 'http://localhost').pathname;
  response.end(
    JSON.stringify(
      path.endsWith('/full')
        ? { set, songs: { [song.id]: song } }
        : path === '/api/library/export'
          ? { songs: [song], sets: [set], collections: [], fingerprint: 'apk-test' }
          : path === '/api/session'
            ? { state, devices: [] }
            : {},
    ),
  );
});
backend.listen(0, '127.0.0.1');
await once(backend, 'listening');
const hub = new WebSocketServer({ server: backend, path: '/ws' });
const hellos = [];
hub.on('connection', (socket) => {
  socket.send(JSON.stringify({ t: 'session', state }));
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.t === 'hello') hellos.push(message);
    if (message.t === 'ping')
      socket.send(
        JSON.stringify({ t: 'pong', clientTime: message.clientTime, serverTime: Date.now() }),
      );
  });
});
const hierarchy = createHierarchyReader(adb);
const tap = (node) => adb('shell', 'input', 'tap', ...center(node).map(String));

try {
  adb('install', '-r', join(root, 'release/worship-archive-band-Android.apk'));
  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-W', '-n', 'com.worshiparchive.band/.BandActivity');
  const initial = await waitFor(() => {
    const xml = hierarchy();
    const inputs = nativeInputs(xml);
    return inputs?.length >= 2 ? { xml, inputs } : null;
  }, 'first-run native setup');
  assert.ok(
    !initial.xml.includes('could not start'),
    'Native Activity and loopback server launched',
  );
  await focusInput(hierarchy, tap, 0);
  adb('shell', 'input', 'text', 'Android-CI');
  await waitFor(
    () => nativeInputs(hierarchy())[0]?.includes('text="Android-CI"'),
    'device name entered in native setup',
  );
  await focusInput(hierarchy, tap, 1);
  adb('shell', 'input', 'text', `10.0.2.2:${backend.address().port}`);
  await waitFor(
    () => nativeInputs(hierarchy())[1]?.includes(`text="10.0.2.2:${backend.address().port}"`),
    'Leader address entered in native setup',
  );
  // The software keyboard can cover the dialog's buttons even though Android's
  // accessibility dump still lists them. Back hides the IME before tapping Connect.
  const keyboard = adb('shell', 'dumpsys', 'input_method');
  if (/mInputShown=true|mIsInputViewShown=true/.test(keyboard))
    adb('shell', 'input', 'keyevent', '4');
  const completedForm = await waitFor(hierarchy, 'completed connection form');
  const positive = completedForm.match(/<node\b[^>]*resource-id="android:id\/button1"[^>]*>/);
  assert.ok(positive, 'Connect button available');
  tap(positive[0]);
  await waitFor(
    () =>
      hellos.some(
        (message) =>
          message.role === 'band' && message.name === 'Android-CI' && message.deviceId,
      ),
    'real APK connected to the test Leader',
  );
  await waitFor(() => hierarchy().includes(song.title), 'Band song rendered in WebView');
  const pid = adb('shell', 'pidof', 'com.worshiparchive.band').trim();
  assert.ok(pid, 'Band process running');
  mkdirSync(join(root, 'build/smoke'), { recursive: true });
  writeFileSync(
    join(root, 'build/smoke/portrait.png'),
    execFileSync('adb', ['-e', 'exec-out', 'screencap', '-p']),
  );
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
  await pause();
  await pause();
  assert.equal(
    adb('shell', 'pidof', 'com.worshiparchive.band').trim(),
    pid,
    'rotation did not restart the app',
  );
  writeFileSync(
    join(root, 'build/smoke/landscape.png'),
    execFileSync('adb', ['-e', 'exec-out', 'screencap', '-p']),
  );
  const logs = adb('logcat', '-d', '--pid=' + pid);
  assert.ok(!logs.includes('FATAL EXCEPTION'), 'No Android runtime crash');
  assert.ok(
    !(await waitFor(hierarchy, 'rotated Android screen')).includes('WebView is too old'),
    'Emulator WebView supports the packaged UI',
  );
  console.log(
    'Android emulator smoke passed: signed APK installed, native setup completed, real Band WebSocket connected, rotation preserved the process, no runtime crash.',
  );
} catch (error) {
  mkdirSync(join(root, 'build/smoke'), { recursive: true });
  for (const [filename, capture] of [
    ['failure.xml', hierarchy],
    ['logcat.txt', () => adb('logcat', '-d', '-t', '2000')],
    ['failure.png', () => execFileSync('adb', ['-e', 'exec-out', 'screencap', '-p'])],
  ]) {
    try {
      writeFileSync(join(root, 'build/smoke', filename), capture());
    } catch {
      /* Retain any diagnostics still available if the emulator is failing. */
    }
  }
  console.log(JSON.stringify({ requests, hellos }));
  throw error;
} finally {
  try {
    adb('shell', 'am', 'force-stop', 'com.worshiparchive.band');
  } catch {
    /* Emulator may already be stopping. */
  }
  for (const socket of hub.clients) socket.terminate();
  hub.close();
  await new Promise((resolve) => backend.close(resolve));
}
