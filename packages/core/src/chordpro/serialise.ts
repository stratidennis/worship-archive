/**
 * Song → ChordPro.
 *
 * Output is deterministic: the same song always produces byte-identical text, so a
 * `.chopro` file only changes in git when the song actually changed.
 *
 * Standard directives come first so that another tool reading the file finds what it
 * expects; our `x_` extensions follow and are ignored by everything else.
 */

import type { Anchor, Block, Line, Song } from '../types.js';
import {
  BLOCK_ENVIRONMENTS,
  FALLBACK_ENVIRONMENT,
  escapeLyric,
} from './directives.js';

function directive(name: string, value: string | number | null): string | null {
  if (value === null || value === '') return null;
  return `{${name}: ${value}}`;
}

/** Re-insert chord anchors into lyric text as `[G]`. */
export function joinChords(line: Line): string {
  if (line.chords.length === 0) return escapeLyric(line.text);

  const sorted = [...line.chords].sort((a, b) => a.at - b.at);
  let out = '';
  let cursor = 0;
  for (const anchor of sorted) {
    const at = Math.max(0, Math.min(anchor.at, line.text.length));
    out += escapeLyric(line.text.slice(cursor, at));
    out += `[${anchor.raw}]`;
    cursor = at;
  }
  out += escapeLyric(line.text.slice(cursor));
  return out;
}

function formatBass(bass: Anchor[]): string | null {
  if (bass.length === 0) return null;
  return bass.map((b) => `${b.at}:${b.raw}`).join(' ');
}

function serialiseBlock(block: Block): string[] {
  const out: string[] = [];
  const env = BLOCK_ENVIRONMENTS[block.type];

  // Types ChordPro has no name for are written as a verse plus an {x_type:}, so the
  // content still shows up in other tools instead of disappearing.
  if (!env) out.push(`{x_type: ${block.type}}`);
  if (block.label !== null) out.push(`{x_label: ${block.label}}`);
  if (block.singers !== null) out.push(`{x_block_singers: ${block.singers}}`);
  if (block.repeat !== null) out.push(`{x_repeat: ${block.repeat}}`);
  if (block.linkToPrevious) out.push('{x_link_prev}');
  if (block.bandOnly) out.push('{x_band_only}');

  const environment = env ?? FALLBACK_ENVIRONMENT;
  out.push(`{start_of_${environment}: ${block.id}}`);

  for (const line of block.lines) {
    if (line.singers !== null) out.push(`{x_singers: ${line.singers}}`);
    if (line.indent !== null) out.push(`{x_indent: ${line.indent}}`);
    if (line.color !== null) out.push(`{x_color: ${line.color}}`);
    const bass = formatBass(line.bass);
    if (bass !== null) out.push(`{x_bass: ${bass}}`);
    out.push(joinChords(line));
  }

  out.push(`{end_of_${environment}}`);
  return out;
}

/**
 * Render a song as ChordPro text.
 *
 * Round-trips {@link parseChordPro} exactly: parse → serialise → parse yields an
 * identical song, and serialise → parse → serialise yields identical text.
 */
export function serialiseChordPro(song: Song): string {
  const lines: (string | null)[] = [
    directive('title', song.title),
    ...song.authors.map((a) => directive('artist', a)),
    directive('key', song.writtenKey),
    directive('tempo', song.tempo),
    directive('time', song.timeSignature),
    directive('copyright', song.copyright),
    directive('ccli', song.ccli),
    directive('lang', song.lang),

    directive('x_id', song.id),
    directive('x_legacy_uuid', song.legacyUuid),
    directive('x_performance_key', song.performanceKey),
    directive('x_tags', song.tags.length ? song.tags.join(', ') : null),
    directive('x_collections', song.collectionIds.length ? song.collectionIds.join(', ') : null),
    directive('x_arrangement', song.arrangement?.length ? song.arrangement.join(' ') : null),
    directive('x_created', song.createdAt),
    directive('x_updated', song.updatedAt),
    directive('x_rev', song.rev),
  ];

  const header = lines.filter((l): l is string => l !== null);
  const body = song.blocks.flatMap((b) => ['', ...serialiseBlock(b)]);
  return [...header, ...body, ''].join('\n');
}
