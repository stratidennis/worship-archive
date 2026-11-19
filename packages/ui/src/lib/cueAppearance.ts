import type { BlockType, CueStyle } from '@worship/core';

const CUE_COLOURS: Record<string, { border: string; background: string }> = {
  Intro: { border: 'var(--color-cue-intro)', background: 'var(--color-cue-intro-bg)' },
  Instrumental: {
    border: 'var(--color-cue-instrumental)',
    background: 'var(--color-cue-instrumental-bg)',
  },
  Bridge: { border: 'var(--color-cue-bridge)', background: 'var(--color-cue-bridge-bg)' },
  Solo: { border: 'var(--color-cue-solo)', background: 'var(--color-cue-solo-bg)' },
  Note: { border: 'var(--color-cue-note)', background: 'var(--color-cue-note-bg)' },
};

export function cueAppearance(type: string): { border: string; background: string } | null {
  return CUE_COLOURS[type] ?? null;
}

const CUE_SCALE = { full: 0.8, compact: 0.7, minimal: 0.6 };
const SMALL_CUES = new Set<BlockType>(['Note', 'Instrumental', 'Intro', 'Tag']);

export function songSectionFontScale(type: BlockType, style: CueStyle): number {
  return SMALL_CUES.has(type) ? CUE_SCALE[style] : 1;
}
