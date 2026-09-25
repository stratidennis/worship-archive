import { describe, expect, it } from 'vitest';
import { newSongDraft } from '../src/lib/newSong.js';

describe('a new unsaved song', () => {
  it('starts with a blank first verse and no title', () => {
    const draft = newSongDraft('2026-09-25T00:00:00.000Z');
    expect(draft.title).toBe('');
    expect(draft.blocks).toHaveLength(1);
    expect(draft.blocks[0]).toMatchObject({
      id: 'V1',
      type: 'Verse',
      lines: [{ text: '', chords: [], bass: [] }],
    });
  });
});
