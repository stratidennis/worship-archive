/**
 * Bulk chord-spelling cleanup — D12.
 *
 * The real library has 105 chords spelled in ways the old app tolerated, in 13 distinct
 * spellings across 23 songs: `Cm#` for `C#m`, a lowercase root, a backslash bass
 * separator, `C#min` for `C#m`. All of them are readable by a human; none of them is
 * what a machine would write.
 *
 * **Nothing here is ever applied automatically.** These are chords people have read off
 * a screen for years, and silently rewriting one is a worse failure than the typo it
 * fixes — the musician plays what is on the screen, and if the screen changed without
 * being asked, the first anyone knows is a wrong chord in front of a congregation. So
 * this module only ever *proposes*, and applying is an explicit, per-chord decision.
 */

import { normalise, type Song } from '@worship/core';
import type { Library } from './library.js';

export interface Suggestion {
  songId: string;
  title: string;
  blockId: string;
  lineIndex: number;
  at: number;
  layer: 'chords' | 'bass';
  /** What is written now. Also the guard against applying a stale suggestion. */
  raw: string;
  fixed: string;
  reason: string;
  /** The lyric line, so the reviewer can see the chord in place rather than alone. */
  context: string;
}

export interface Audit {
  suggestions: Suggestion[];
  /** Distinct raw spellings, so the reviewer can judge scale before reading 67 rows. */
  spellings: { raw: string; fixed: string; reason: string; count: number }[];
  songsAffected: number;
  chordsScanned: number;
}

export function auditSong(song: Song): Suggestion[] {
  const out: Suggestion[] = [];
  for (const block of song.blocks) {
    block.lines.forEach((line, lineIndex) => {
      for (const layer of ['chords', 'bass'] as const) {
        for (const anchor of line[layer]) {
          const suggestion = normalise(anchor.raw);
          if (!suggestion) continue;
          out.push({
            songId: song.id,
            title: song.title,
            blockId: block.id,
            lineIndex,
            at: anchor.at,
            layer,
            raw: anchor.raw,
            fixed: suggestion.fixed,
            reason: suggestion.reason,
            context: line.text,
          });
        }
      }
    });
  }
  return out;
}

export function auditLibrary(library: Library): Audit {
  const suggestions: Suggestion[] = [];
  const songs = new Set<string>();
  let chordsScanned = 0;

  for (const song of library.all()) {
    for (const block of song.blocks) {
      for (const line of block.lines) chordsScanned += line.chords.length + line.bass.length;
    }
    const found = auditSong(song);
    if (found.length > 0) songs.add(song.id);
    suggestions.push(...found);
  }

  const bySpelling = new Map<
    string,
    { raw: string; fixed: string; reason: string; count: number }
  >();
  for (const s of suggestions) {
    const existing = bySpelling.get(s.raw);
    if (existing) existing.count++;
    else bySpelling.set(s.raw, { raw: s.raw, fixed: s.fixed, reason: s.reason, count: 1 });
  }

  return {
    suggestions,
    spellings: [...bySpelling.values()].sort(
      (a, b) => b.count - a.count || a.raw.localeCompare(b.raw),
    ),
    songsAffected: songs.size,
    chordsScanned,
  };
}

export interface Fix {
  songId: string;
  blockId: string;
  lineIndex: number;
  at: number;
  layer: 'chords' | 'bass';
  /** What the reviewer saw. A mismatch means the song moved on; the fix is dropped. */
  raw: string;
  fixed: string;
}

export interface ApplyResult {
  songs: number;
  chords: number;
  /** Fixes that no longer matched — the song was edited between review and apply. */
  stale: number;
}

/**
 * Apply reviewed fixes.
 *
 * Grouped per song so each one is written — and revision-snapshotted — exactly once,
 * which is what makes the whole cleanup a single undo rather than 67 of them.
 */
export function applyFixes(library: Library, fixes: Fix[]): ApplyResult {
  const bySong = new Map<string, Fix[]>();
  for (const fix of fixes) {
    const list = bySong.get(fix.songId);
    if (list) list.push(fix);
    else bySong.set(fix.songId, [fix]);
  }

  let songsChanged = 0;
  let chords = 0;
  let stale = 0;

  for (const [songId, songFixes] of bySong) {
    const song = library.get(songId);
    if (!song) {
      stale += songFixes.length;
      continue;
    }

    let changed = false;
    const blocks = song.blocks.map((block) => {
      const forBlock = songFixes.filter((f) => f.blockId === block.id);
      if (forBlock.length === 0) return block;
      const lines = block.lines.map((line, lineIndex) => {
        const forLine = forBlock.filter((f) => f.lineIndex === lineIndex);
        if (forLine.length === 0) return line;
        let next = line;
        for (const layer of ['chords', 'bass'] as const) {
          const anchors = next[layer].map((anchor) => {
            const fix = forLine.find((f) => f.layer === layer && f.at === anchor.at);
            if (!fix) return anchor;
            if (fix.raw !== anchor.raw) {
              stale++;
              return anchor;
            }
            changed = true;
            chords++;
            return { ...anchor, raw: fix.fixed };
          });
          next = { ...next, [layer]: anchors };
        }
        return next;
      });
      return { ...block, lines };
    });

    if (!changed) continue;
    library.save({ ...song, blocks });
    songsChanged++;
  }

  return { songs: songsChanged, chords, stale };
}
