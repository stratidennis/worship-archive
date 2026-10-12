import { describe, expect, it } from 'vitest';
import { historyDirection } from '../src/navigation.js';

describe('desktop hardware navigation commands', () => {
  it('recognises Back and Forward without treating unrelated app commands as navigation', () => {
    expect(historyDirection('browser-backward')).toBe(-1);
    expect(historyDirection('browser-forward')).toBe(1);
    expect(historyDirection('media-play-pause')).toBe(0);
  });
});
