/** CI emulator verification for the self-contained Android Leader host. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--emulator'))
  throw new Error(
    'This test requires explicit --emulator; it must not install on a physical device.',
  );
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adb = (...args) =>
  execFileSync('adb', ['-e', ...args], { encoding: 'utf8', timeout: 30000 });
const origin = 'http://127.0.0.1:17374';
const waitFor = async (read, label, attempts = 30) => {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} timed out${last ? `: ${last}` : ''}`);
};
const request = async (path, options) => {
  const response = await fetch(origin + path, options);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
};
const screenshot = (name) => {
  mkdirSync(join(root, 'build/smoke'), { recursive: true });
  writeFileSync(
    join(root, 'build/smoke', name + '.png'),
    execFileSync('adb', ['-e', 'exec-out', 'screencap', '-p']),
  );
};

try {
  adb('install', '-r', join(root, 'release/worship-archive-leader-Android.apk'));
  adb('forward', 'tcp:17374', 'tcp:7374');
  adb('shell', 'am', 'force-stop', 'com.worshiparchive.leader');
  adb(
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    'com.worshiparchive.leader/com.worshiparchive.band.LeaderActivity',
  );
  const stats = await waitFor(() => request('/api/stats'), 'Android Leader API startup');
  assert.equal(typeof stats.songs, 'number');
  assert.deepEqual(await request('/api/cloud-sync'), {
    configured: false,
    remoteRoot: null,
    lastSync: null,
    trackedFiles: 0,
  });
  const now = new Date().toISOString();
  const song = await request('/api/songs?location=Main', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'ANDROID LEADER SMOKE SONG',
      writtenKey: 'G',
      performanceKey: 'G',
      tempo: 72,
      timeSignature: '4/4',
      authors: [],
      tags: ['smoke'],
      blocks: [
        {
          id: 'V1',
          type: 'Verse',
          label: null,
          repeat: null,
          singers: null,
          linkToPrevious: false,
          lines: [
            {
              text: 'The Android tablet owns this library',
              chords: [{ at: 0, raw: 'G' }],
              bass: [],
              indent: 0,
              color: null,
            },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    }),
  });
  assert.ok(song.id, 'Leader created a persistent song');
  const songs = await request('/api/songs');
  assert.ok(
    songs.some((entry) => entry.id === song.id),
    'Archive API lists the created song',
  );
  const edited = await request(`/api/songs/${encodeURIComponent(song.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...song, title: 'ANDROID LEADER EDITED SONG' }),
  });
  const revisions = await request(`/api/songs/${encodeURIComponent(song.id)}/revisions`);
  assert.equal(revisions[0].rev, song.rev, 'Editing records the previous song revision');
  assert.equal(
    (await request(`/api/songs/${encodeURIComponent(song.id)}/revisions/${song.rev}`)).title,
    song.title,
  );
  const restored = await request(
    `/api/songs/${encodeURIComponent(song.id)}/revisions/${song.rev}/restore`,
    { method: 'POST' },
  );
  assert.equal(restored.title, song.title, 'A previous song revision can be restored');
  assert.ok(restored.rev > edited.rev, 'Restoring creates a new recoverable revision');
  const set = await request('/api/sets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Android set', date: null }),
  });
  set.items = [{ kind: 'song', songId: song.id }];
  await request(`/api/sets/${encodeURIComponent(set.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(set),
  });
  const full = await request(`/api/sets/${encodeURIComponent(set.id)}/full`);
  assert.equal(full.songs[song.id].title, song.title, 'Set API includes its song');

  const pid = adb('shell', 'pidof', 'com.worshiparchive.leader').trim();
  assert.ok(pid, 'Leader process is running');
  screenshot('leader-home');
  adb('shell', 'wm', 'user-rotation', 'lock', '1');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(adb('shell', 'pidof', 'com.worshiparchive.leader').trim(), pid);
  assert.equal((await request(`/api/songs/${song.id}`)).title, song.title);
  screenshot('leader-landscape');
  adb('shell', 'wm', 'user-rotation', 'lock', '0');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(adb('shell', 'pidof', 'com.worshiparchive.leader').trim(), pid);
  assert.equal((await request('/api/session')).state.leaderId.length > 0, true);
  screenshot('leader-portrait-return');
  console.log(
    'Android Leader emulator smoke passed: app started, archive/song/set/session APIs worked, data survived both rotations, and the bundled interface remained running.',
  );
} catch (error) {
  mkdirSync(join(root, 'build/smoke'), { recursive: true });
  try {
    writeFileSync(
      join(root, 'build/smoke', 'leader-logcat.txt'),
      adb('logcat', '-d', '-t', '2000'),
    );
    screenshot('leader-failure');
  } catch {
    // Preserve the original failure if the emulator itself is no longer reachable.
  }
  throw error;
} finally {
  try {
    adb('shell', 'am', 'force-stop', 'com.worshiparchive.leader');
    adb('forward', '--remove', 'tcp:17374');
  } catch {
    // The emulator runner will perform final cleanup.
  }
}
