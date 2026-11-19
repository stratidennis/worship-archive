import type { CueStyle } from '@worship/core';

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

/** Default panel colors and the size of its text in the song reader. */
export function cueAppearance(
  type: string,
  style: CueStyle = 'full',
): {
  border: string;
  background: string;
  fontScale: number;
} | null {
  const colours = CUE_COLOURS[type];
  if (!colours) return null;
  const fontScale = { full: 0.8, compact: 0.7, minimal: 0.6 }[style];
  return {
    ...colours,
    fontScale: type === 'Bridge' ? 1 : fontScale,
  };
}
