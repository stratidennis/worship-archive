import {
  READING_COLOR_KEYS,
  READING_SECTION_COLORS,
  normaliseReadingColors,
  type ReadingColors,
} from '@worship/core';
import type { CSSProperties } from 'react';

export const LYRIC_INK = 'var(--reading-lyrics, var(--color-stage-fg))';
export const SETUP_BACKGROUND =
  'color-mix(in srgb, var(--color-chord) 8%, var(--color-stage-bg))';

/** Scope Stage and previews independently from the device's own reader. */
export function readingColorStyle(colors: ReadingColors): CSSProperties {
  const style: Record<string, string> = {};
  const safe = normaliseReadingColors(colors);
  for (const key of READING_COLOR_KEYS) {
    style[`--reading-${key}`] = safe[key] ?? 'initial';
  }
  for (const key of READING_SECTION_COLORS) {
    style[`--reading-${key}-edge`] = safe[key] === 'transparent' ? 'transparent' : 'initial';
  }
  return style as CSSProperties;
}
