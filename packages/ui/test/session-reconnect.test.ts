import { describe, expect, it } from 'vitest';
import { acceptsSessionSnapshot } from '../src/lib/useSession.js';

describe('session snapshots across reconnects', () => {
  it('accepts a newly connected Leader even when its revision is lower', () => {
    expect(acceptsSessionSnapshot(true, 104, 2)).toBe(true);
  });

  it('rejects stale frames after the new connection has synchronized', () => {
    expect(acceptsSessionSnapshot(false, 104, 2)).toBe(false);
    expect(acceptsSessionSnapshot(false, 104, 105)).toBe(true);
  });
});
