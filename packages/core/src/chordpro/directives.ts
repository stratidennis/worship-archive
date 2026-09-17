/**
 * ChordPro directive vocabulary.
 *
 * Standard directives carry everything other tools understand. Our own additions use
 * the `x_` custom-directive convention — every ChordPro parser in existence ignores
 * unknown directives, so a `.chopro` file written here stays valid and readable in
 * OnSong, SongBook, Chordii and the rest. They simply see a slightly plainer song.
 */

import type { BlockType } from '../types.js';

/** Short aliases used widely in the wild, mapped to their long form. */
export const DIRECTIVE_ALIASES: Record<string, string> = {
  t: 'title',
  st: 'subtitle',
  su: 'subtitle',
  a: 'artist',
  c: 'comment',
  ci: 'comment_italic',
  cb: 'comment_box',
  soc: 'start_of_chorus',
  eoc: 'end_of_chorus',
  sov: 'start_of_verse',
  eov: 'end_of_verse',
  sob: 'start_of_bridge',
  eob: 'end_of_bridge',
  sot: 'start_of_tab',
  eot: 'end_of_tab',
  k: 'key',
};

/**
 * Block types that map onto a standard ChordPro environment.
 *
 * Everything else is written as a verse environment plus an `{x_type:}` directive, so
 * the content still appears in other tools rather than vanishing.
 */
export const BLOCK_ENVIRONMENTS: Partial<Record<BlockType, string>> = {
  Verse: 'verse',
  Chorus: 'chorus',
  Bridge: 'bridge',
};

export const ENVIRONMENT_BLOCKS: Record<string, BlockType> = {
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
};

/** The environment used for block types ChordPro has no name for. */
export const FALLBACK_ENVIRONMENT = 'verse';

/** Characters that must be escaped inside lyric text. */
const ESCAPE_RE = /([\\[\]{}])/g;

export function escapeLyric(text: string): string {
  return text.replace(ESCAPE_RE, '\\$1');
}

export function unescapeLyric(text: string): string {
  return text.replace(/\\([\\[\]{}])/g, '$1');
}
