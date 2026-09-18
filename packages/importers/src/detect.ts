/**
 * Picking the right importer for a file someone found.
 *
 * The promise made when ChordPro was chosen as the storage format was that a chord
 * chart found anywhere could be brought in. That promise is kept here: the user drops
 * a file and the app works out what it is, rather than asking them to know.
 *
 * Detection reads the *content*, and uses the filename only to break ties. Extensions
 * lie constantly — OpenSong files usually have no extension at all, and plenty of
 * ChordPro is saved as `.txt`.
 */

import { parseChordPro, type Song } from '@worship/core';
import { importSongXml, type ImportNote } from './song-xml.js';
import { importOpenSong, looksLikeOpenSong } from './opensong.js';
import { importPlainText } from './plain-text.js';

export type ImportFormat = 'chordpro' | 'opensong' | 'legacy-song' | 'plain-text';

export interface DetectedImport {
  song: Song;
  format: ImportFormat;
  notes: ImportNote[];
}

/** SwiftTec's own XML — the format this whole project is replacing. */
function looksLikeLegacySong(source: string): boolean {
  return (
    /<song[^>]*swifttec\/song/i.test(source) ||
    (/<song[\s>]/i.test(source) && /<info>/i.test(source))
  );
}

/**
 * ChordPro is identified by a directive or an inline chord.
 *
 * A bare `[G]` is enough: no other format in this list puts square brackets inside a
 * line of words, and plain text with chords keeps them on their own line.
 */
function looksLikeChordPro(source: string): boolean {
  if (/^\s*\{\s*(title|t|subtitle|st|key|artist|start_of_\w+|soc|sov)\s*[:}]/im.test(source))
    return true;
  return /\S\[[A-G][^\]]{0,12}\]/.test(source);
}

export function detectFormat(source: string, filename = ''): ImportFormat {
  if (looksLikeLegacySong(source)) return 'legacy-song';
  if (looksLikeOpenSong(source)) return 'opensong';
  if (looksLikeChordPro(source)) return 'chordpro';
  // Extension as a tiebreak only — an empty or chordless ChordPro file has nothing in
  // its content to recognise, and `.chopro` is then the only evidence there is.
  if (/\.(chopro|cho|chordpro|pro|crd)$/i.test(filename)) return 'chordpro';
  if (/\.song$/i.test(filename) && /^\s*</.test(source)) return 'legacy-song';
  return 'plain-text';
}

export function importAny(
  source: string,
  options: {
    filename?: string | undefined;
    id?: string | undefined;
    now?: string | undefined;
  } = {},
): DetectedImport {
  const filename = options.filename ?? '';
  const format = detectFormat(source, filename);
  const stem = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  switch (format) {
    case 'legacy-song': {
      const result = importSongXml(source, {
        ...(filename ? { filename } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.id ? { makeId: (): string => options.id! } : {}),
      });
      return { song: result.song, format, notes: result.notes };
    }
    case 'opensong':
      return { song: importOpenSong(source, options), format, notes: [] };
    case 'chordpro': {
      const song = parseChordPro(source, {
        ...(options.now ? { now: options.now } : {}),
        ...(options.id ? { makeId: (): string => options.id! } : {}),
      });
      // A ChordPro file with no `{title}` is common when it came out of a text editor.
      const titled = song.title.trim() === '' && stem ? { ...song, title: stem } : song;
      return {
        song: titled,
        format,
        notes:
          titled === song
            ? []
            : [{ kind: 'title-from-filename', detail: `title taken from "${filename}"` }],
      };
    }
    case 'plain-text':
      return { song: importPlainText(source, options), format, notes: [] };
  }
}
