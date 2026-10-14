import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  center,
  createHierarchyReader,
  focusInput,
  textInsideScreen,
  UiNotReadyError,
  waitFor,
} from '../scripts/smoke-ui.mjs';

test('a missing accessibility root is retried instead of reading a missing/stale XML file', async () => {
  let dumps = 0;
  let cats = 0;
  const hierarchy = createHierarchyReader((...args) => {
    if (args[1] === 'uiautomator')
      return ++dumps === 1 ? '' : 'UI hierchary dumped to: /sdcard/worship-band-smoke.xml';
    cats++;
    return '<hierarchy>ready</hierarchy>';
  });
  assert.equal(
    await waitFor(hierarchy, 'screen', { attempts: 2, pause: async () => {} }),
    '<hierarchy>ready</hierarchy>',
  );
  assert.equal(dumps, 2);
  assert.equal(cats, 1);
});

test('a transient failed XML read is retried', async () => {
  let reads = 0;
  const hierarchy = createHierarchyReader((...args) => {
    if (args[1] === 'uiautomator') return 'UI hierarchy dumped to: file';
    if (++reads === 1) throw new Error('cat: file missing');
    return '<hierarchy />';
  });
  assert.equal(
    await waitFor(hierarchy, 'screen', { attempts: 2, pause: async () => {} }),
    '<hierarchy />',
  );
});

test('the Android fullscreen tutorial is dismissed before reading the app form', () => {
  let reads = 0;
  const taps = [];
  const hierarchy = createHierarchyReader((...args) => {
    if (args[1] === 'uiautomator') return 'UI hierarchy dumped to: file';
    if (args[1] === 'input') {
      taps.push(args);
      return '';
    }
    return ++reads === 1
      ? '<hierarchy><node resource-id="immersive_cling" /><node resource-id="com.android.systemui:id/ok" bounds="[225,182][296,230]" /></hierarchy>'
      : '<hierarchy>app form</hierarchy>';
  });
  assert.equal(hierarchy(), '<hierarchy>app form</hierarchy>');
  assert.deepEqual(taps, [['shell', 'input', 'tap', '261', '206']]);
});

test('unavailable screens still fail after bounded retries', async () => {
  await assert.rejects(
    waitFor(
      () => {
        throw new UiNotReadyError('not ready');
      },
      'setup',
      {
        attempts: 2,
        pause: async () => {},
      },
    ),
    /Timed out: setup/,
  );
});

test('rotation checks reject song endings outside the screen or with empty/clipped bounds', () => {
  const node = (bounds) => `<node text="ANDROID-END-OF-SONG" bounds="${bounds}" />`;
  assert.equal(
    textInsideScreen(node('[800,900][1100,940]'), 'ANDROID-END-OF-SONG', 1200, 2000),
    true,
  );
  for (const bounds of [
    '[800,1900][1100,2050]',
    '[1100,900][1300,940]',
    '[0,0][0,0]',
    '[800,1195][1100,1200]',
  ]) {
    assert.equal(textInsideScreen(node(bounds), 'ANDROID-END-OF-SONG', 1200, 1200), false);
  }
});

test('real assertions are never swallowed by startup retries', async () => {
  await assert.rejects(
    waitFor(() => assert.fail('bad APK'), 'setup'),
    /bad APK/,
  );
  assert.deepEqual(center('<node bounds="[0,10][100,50]" />'), [50, 30]);
});

test('typing waits for the intended field to focus after Android moves the dialog', async () => {
  let reads = 0;
  const taps = [];
  const hierarchy = () => {
    reads++;
    return `<node class="android.widget.EditText" focused="${reads >= 3}" bounds="[36,${reads === 1 ? 211 : 152}][284,${reads === 1 ? 257 : 198}]" />`;
  };
  const input = await focusInput(hierarchy, (node) => taps.push(center(node)), 0, {
    attempts: 3,
    pause: async () => {},
  });
  assert.ok(input.includes('focused="true"'));
  assert.deepEqual(taps, [
    [160, 234],
    [160, 175],
  ]);
});

test('an auto-focused field is explicitly activated before typing', async () => {
  let reads = 0;
  const taps = [];
  const node =
    '<node class="android.widget.EditText" focused="true" bounds="[0,10][100,50]" />';
  await focusInput(
    () => {
      reads++;
      return node;
    },
    (input) => taps.push(center(input)),
    0,
    {
      attempts: 2,
      pause: async () => {},
    },
  );
  assert.equal(reads, 2);
  assert.deepEqual(taps, [[50, 30]]);
});
