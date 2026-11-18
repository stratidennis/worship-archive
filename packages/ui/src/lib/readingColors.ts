import { READING_COLOR_KEYS, normaliseReadingColors, type ReadingColors } from '@worship/core';
import type { CSSProperties } from 'react';

/** Scope Stage and previews independently from the device's own reader. */
export function readingColorStyle(colors: ReadingColors): CSSProperties {
  const style: Record<string, string> = {};
  const safe = normaliseReadingColors(colors);
  for (const key of READING_COLOR_KEYS) {
    style[`--reading-${key}`] = safe[key] ?? 'initial';
  }
  for (const key of READING_TINTED_CUES) {
    style[`--reading-${key}-surface`] = safe[key] ? cueSurface(key) : 'initial';
  }
  return style as CSSProperties;
}

const READING_TINTED_CUES = ['Intro', 'Instrumental', 'Note'] as const;
const cueSurface = (key: string): string =>
  `color-mix(in srgb, var(--reading-${key}) 10%, var(--reading-background, var(--color-stage-bg)))`;
