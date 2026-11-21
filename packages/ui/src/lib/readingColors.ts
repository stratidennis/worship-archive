import {
  BLOCK_TYPES,
  READING_COLOR_KEYS,
  READING_SECTIONS,
  isReadingColor,
  normaliseReadingColors,
  sectionBackground,
  sectionText,
  type CueStyle,
  type ReadingColorKey,
  type ReadingColors,
  type ReadingSection,
} from '@worship/core';
import type { CSSProperties } from 'react';
import { cueAppearance } from './cueAppearance.js';

export const LYRIC_INK = 'var(--reading-lyrics, var(--color-stage-fg))';
export const SETUP_BACKGROUND =
  'color-mix(in srgb, var(--color-chord) 8%, var(--color-stage-bg))';
export const SETUP_ACCENT = 'var(--color-chord)';

export function sectionAccentInk(key: ReadingColorKey, accent: string): string {
  const mixed = `color-mix(in oklab, ${accent} var(--minimal-accent-share, 38%), var(--color-minimal-ink-base, var(--color-stage-fg)))`;
  return `var(--minimal-${key}-ink, ${mixed})`;
}

export function readingSectionStyle(
  key: ReadingSection,
  mode: CueStyle,
  panel: { border: string; background: string } | null,
): CSSProperties {
  if (mode === 'minimal') {
    return {
      color: `var(--reading-${key}-ink, ${panel ? sectionAccentInk(key, panel.border) : LYRIC_INK})`,
    };
  }
  return {
    color: `var(--reading-${key}Text, ${LYRIC_INK})`,
    backgroundColor: `var(--reading-${key}-background, ${panel?.background ?? 'transparent'})`,
    borderColor: `var(--reading-${key}-edge, ${panel?.border ?? 'transparent'})`,
  };
}

/** Refit a live chart when a background adds or removes a padded panel. */
export function sectionPanelLayoutKey(colors: ReadingColors, mode: CueStyle = 'full'): string {
  if (mode === 'minimal') return '';
  return BLOCK_TYPES.filter(
    (type) => !cueAppearance(type) && isReadingColor(sectionBackground(colors, type)),
  ).join(',');
}

/** Scope Stage and previews independently from the device's own reader. */
export function readingColorStyle(colors: ReadingColors): CSSProperties {
  const style: Record<string, string> = {};
  const safe = normaliseReadingColors(colors);
  for (const key of READING_COLOR_KEYS) {
    style[`--reading-${key}`] = safe[key] ?? 'initial';
  }
  for (const key of READING_SECTIONS) {
    const color = sectionBackground(safe, key);
    const text = sectionText(safe, key, true);
    style[`--reading-${key}-background`] = color ?? 'initial';
    style[`--reading-${key}-panel`] = color && color !== 'transparent' ? '1' : 'initial';
    style[`--reading-${key}-edge`] =
      color === 'transparent'
        ? 'transparent'
        : color
          ? `color-mix(in oklab, ${color} 65%, var(--color-stage-fg))`
          : 'initial';
    style[`--reading-${key}-ink`] = text === 'transparent' ? LYRIC_INK : (text ?? 'initial');
  }
  return style as CSSProperties;
}
