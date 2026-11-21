import { BLOCK_TYPES, SINGERS } from './types.js';

export const READING_TEXT_COLORS = [
  'chords',
  'bass',
  'lyrics',
  'titles',
  'repeats',
  'infoDetails',
] as const;
export const READING_SECTIONS = ['info', ...BLOCK_TYPES] as const;
export type ReadingSection = (typeof READING_SECTIONS)[number];
export const READING_SECTION_COLORS = ['background', ...READING_SECTIONS] as const;
const SECTION_BACKGROUNDS = READING_SECTIONS.map((section) => `${section}Background` as const);
const SECTION_TEXT = READING_SECTIONS.map((section) => `${section}Text` as const);
export const READING_COLOR_KEYS = [
  ...READING_TEXT_COLORS,
  ...READING_SECTION_COLORS,
  ...SECTION_BACKGROUNDS,
  ...SECTION_TEXT,
  ...SINGERS,
] as const;
export type ReadingColorKey = (typeof READING_COLOR_KEYS)[number];
/** A missing entry inherits. Null uses the theme default. Sections also accept transparent. */
export type ReadingColors = Partial<Record<ReadingColorKey, string | null>>;

export interface ReadingTheme {
  theme: 'light' | 'dark';
  readingColors: ReadingColors;
}

export function normaliseReadingTheme(value: unknown): ReadingTheme | null {
  if (!value || typeof value !== 'object') return null;
  const { theme, readingColors } = value as Record<string, unknown>;
  if (
    (theme !== 'light' && theme !== 'dark') ||
    !readingColors ||
    typeof readingColors !== 'object' ||
    Array.isArray(readingColors)
  )
    return null;
  return { theme, readingColors: normaliseReadingColors(readingColors) };
}

export function isReadingColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function isReadingSectionColor(key: ReadingColorKey): boolean {
  return (
    READING_SECTION_COLORS.some((section) => section === key) ||
    SECTION_BACKGROUNDS.some((section) => section === key)
  );
}

export function sectionBackground(colors: ReadingColors, section: ReadingSection) {
  const color = colors[`${section}Background`];
  return color === undefined ? colors[section] : color;
}

export function sectionText(colors: ReadingColors, section: ReadingSection, minimal: boolean) {
  const color = colors[`${section}Text`];
  return color === undefined && minimal ? colors[section] : color;
}

export function layerReadingColors(...layers: (ReadingColors | undefined)[]): ReadingColors {
  const result: ReadingColors = {};
  for (const colors of layers) {
    if (!colors) continue;
    for (const section of READING_SECTIONS) {
      const key = `${section}Background` as const;
      if (colors[section] !== undefined && colors[key] === undefined) delete result[key];
    }
    Object.assign(result, colors);
  }
  return result;
}

export function withReadingColor(
  colors: ReadingColors,
  key: ReadingColorKey,
  value: string | null | undefined,
): ReadingColors {
  const result = { ...colors };
  if (value === undefined) {
    delete result[key];
    const section = READING_SECTIONS.find((section) => `${section}Background` === key);
    if (section) delete result[section];
  } else {
    result[key] = value;
  }
  return result;
}

export function normaliseReadingColors(value: unknown): ReadingColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: ReadingColors = {};
  for (const key of READING_COLOR_KEYS) {
    const color = input[key];
    if (
      color === null ||
      isReadingColor(color) ||
      (color === 'transparent' && isReadingSectionColor(key))
    )
      result[key] = color;
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
