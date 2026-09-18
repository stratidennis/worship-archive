import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomId } from '../src/id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('randomId', () => {
  it('produces a version 4 UUID', () => {
    expect(randomId()).toMatch(UUID);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(seen.size).toBe(500);
  });

  /*
    The case this exists for.

    Served over plain HTTP from a laptop on the church WiFi, every device except the
    host is in an insecure context, and `crypto.randomUUID` is simply not there. The
    band view used to die on load with "crypto.randomUUID is not a function", and it
    went unnoticed because localhost *is* a secure context — so every test until this
    one was run somewhere the bug could not happen.
  */
  it('still works where crypto.randomUUID does not exist', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(() => randomId()).not.toThrow();
    expect(randomId()).toMatch(UUID);
    expect(new Set(Array.from({ length: 200 }, () => randomId())).size).toBe(200);
  });

  it('still works with no Web Crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomId()).toMatch(UUID);
    expect(new Set(Array.from({ length: 200 }, () => randomId())).size).toBe(200);
  });
});
