import { afterEach, expect, it, vi } from 'vitest';
import { supportsPresentations } from '../src/lib/presentationCapabilities.js';
afterEach(() => vi.unstubAllGlobals());
it('uses native platform capabilities for every Android role and preserves desktop roles', () => {
  for (const bridge of [{}, { isLeader: true }]) {
    vi.stubGlobal('window', { worshipAndroid: bridge });
    expect(supportsPresentations('leader')).toBe(false);
    expect(supportsPresentations('band')).toBe(false);
  }
  vi.stubGlobal('window', { worship: { isDesktop: true } });
  expect(supportsPresentations('leader')).toBe(true);
  for (const role of ['band', 'stage']) {
    vi.stubGlobal('window', { worshipClient: { role } });
    expect(supportsPresentations('band')).toBe(true);
  }
  vi.stubGlobal('window', {});
  expect(supportsPresentations('leader')).toBe(true); // desktop-hosted HTTP API remains supported
  expect(supportsPresentations('band')).toBe(false);
});
