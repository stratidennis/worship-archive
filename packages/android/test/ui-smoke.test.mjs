import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  center,
  createHierarchyReader,
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

test('real assertions are never swallowed by startup retries', async () => {
  await assert.rejects(
    waitFor(() => assert.fail('bad APK'), 'setup'),
    /bad APK/,
  );
  assert.deepEqual(center('<node bounds="[0,10][100,50]" />'), [50, 30]);
});
