import type { CueStyle } from '@worship/core';

const CUE_COLOURS: Record<string, { border: string; background: string }> = {
  Intro: { border: 'var(--color-cue-intro)', background: 'var(--color-cue-intro-bg)' },
  Instrumental: {
    border: 'var(--color-cue-instrumental)',
    background: 'var(--color-cue-instrumental-bg)',
  },
  Solo: { border: 'var(--color-cue-solo)', background: 'var(--color-cue-solo-bg)' },
  Note: { border: 'var(--color-cue-note)', background: 'var(--color-cue-note-bg)' },
};

/** Visual treatment shared by every place that renders a non-lyric song cue. */
export function cueAppearance(
  type: string,
  style: CueStyle = 'full',
): {
  border: string;
  background: string;
  fontScale: number;
  coloured: boolean;
  text: string | null;
} | null {
  const colours = CUE_COLOURS[type];
  if (!colours) return null;
  if (style === 'minimal') {
    // Keep the cue's semantic colour after removing its background. The border colour
    // is the readable foreground counterpart of that background in both themes.
    return { ...colours, fontScale: 0.45, coloured: false, text: colours.border };
  }
  return {
    ...colours,
    fontScale: style === 'compact' ? 0.6 : 0.75,
    coloured: true,
    text: null,
  };
}
