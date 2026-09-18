import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseSet, forgetSet, lastSet, rememberSet } from '../src/lib/lastSet.js';

/**
 * A minimal localStorage, because the tests run in Node.
 *
 * Deliberately small: the interesting case is not that a map stores strings, it is that
 * every access is guarded — in a private window these throw, and an app that cannot
 * remember a set must still open one.
 */
function installStorage(behaviour: 'works' | 'throws' = 'works'): void {
  const map = new Map<string, string>();
  const fail = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  globalThis.localStorage = {
    getItem: behaviour === 'throws' ? fail : (k: string) => map.get(k) ?? null,
    setItem: behaviour === 'throws' ? fail : (k: string, v: string) => void map.set(k, v),
    removeItem: behaviour === 'throws' ? fail : (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('choosing which set to open', () => {
  const sets = [
    { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'newest', createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'middle', createdAt: '2026-02-01T00:00:00.000Z' },
  ];

  it('reopens the one this device was last in', () => {
    expect(chooseSet(sets, 'middle')?.id).toBe('middle');
  });

  it('falls back to the newest when nothing is remembered', () => {
    expect(chooseSet(sets, null)?.id).toBe('newest');
  });

  it('falls back when the remembered set no longer exists', () => {
    // Deleted on the host while this device was away. Sending it to a page that cannot
    // load would look like the app is broken.
    expect(chooseSet(sets, 'deleted-on-the-host')?.id).toBe('newest');
  });

  it('returns null when there are no sets, so the caller can make one', () => {
    expect(chooseSet([], 'anything')).toBeNull();
  });

  it('copes with sets that only have updatedAt', () => {
    const partial = [
      { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', updatedAt: '2026-05-01T00:00:00.000Z' },
    ];
    expect(chooseSet(partial, null)?.id).toBe('b');
  });

  it('does not reorder the caller’s array', () => {
    const order = sets.map((s) => s.id);
    chooseSet(sets, null);
    expect(sets.map((s) => s.id)).toEqual(order);
  });
});

describe('remembering across restarts', () => {
  beforeEach(() => installStorage());
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('round-trips', () => {
    rememberSet('set-1');
    expect(lastSet()).toBe('set-1');
  });

  it('starts empty', () => {
    expect(lastSet()).toBeNull();
  });

  it('forgets only the set it is told about', () => {
    rememberSet('set-1');
    forgetSet('set-2');
    expect(lastSet()).toBe('set-1');
    forgetSet('set-1');
    expect(lastSet()).toBeNull();
  });
});

describe('when storage is blocked', () => {
  // A private window, or a browser with site data switched off. The app must still open
  // a set; it just cannot remember which one.
  beforeEach(() => installStorage('throws'));
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('reads as nothing remembered rather than throwing', () => {
    expect(() => lastSet()).not.toThrow();
    expect(lastSet()).toBeNull();
  });

  it('swallows a failed write', () => {
    expect(() => rememberSet('set-1')).not.toThrow();
    expect(() => forgetSet('set-1')).not.toThrow();
  });
});

describe('when there is no storage at all', () => {
  // Server-side rendering, or a very locked-down embedded webview.
  it('still answers', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(lastSet()).toBeNull();
    expect(() => rememberSet('x')).not.toThrow();
  });
});
