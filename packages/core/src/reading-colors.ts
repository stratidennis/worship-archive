import { BLOCK_TYPES, SINGERS } from './types.js';

export const READING_TEXT_COLORS = [
  'chords',
  'bass',
  'lyrics',
  'background',
  'titles',
  'repeats',
  'info',
  'infoDetails',
] as const;
export const READING_COLOR_KEYS = [...READING_TEXT_COLORS, ...BLOCK_TYPES, ...SINGERS] as const;
export type ReadingColorKey = (typeof READING_COLOR_KEYS)[number];
/** A missing entry inherits. An explicit null uses the theme default. */
export type ReadingColors = Partial<Record<ReadingColorKey, string | null>>;

export function isReadingColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function normaliseReadingColors(value: unknown): ReadingColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: ReadingColors = {};
  for (const key of READING_COLOR_KEYS) {
    const color = input[key];
    if (color === null || isReadingColor(color)) result[key] = color;
  }
  return result;
}

/** Preserve chord preferences from older hosts and installations. */
export function readingColorsWithChords(
  colors: ReadingColors | undefined,
  chordColor: string | null,
): ReadingColors {
  return {
    ...(isReadingColor(chordColor) ? { chords: chordColor } : {}),
    ...colors,
  };
}
