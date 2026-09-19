import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library } from '../src/library.js';
import { applyFixes, auditLibrary, auditSong } from '../src/cleanup.js';
import { parseChordPro } from '@worship/core';

let dir: string;
let library: Library;

function writeSong(relPath: string, text: string): void {
  const full = join(dir, 'songs', relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text, 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-cleanup-'));
  library = new Library(dir);
});

afterEach(() => {
  library.close();
  rmSync(dir, { recursive: true, force: true });
});

const MESSY = `{title: Cu spelling ciudat}
{key: C}
{x_id: id-1}

{start_of_verse: V1}
Eu Te iu[Cm#]besc, mila [g]Ta
{end_of_verse}
`;

const CLEAN = `{title: Curat}
{key: G}
{x_id: id-2}

{start_of_verse: V1}
Eu Te iu[G]besc, mila [C#m]Ta
{end_of_verse}
`;

describe('auditing a song', () => {
  it('proposes a fix for a misplaced accidental', () => {
    const found = auditSong(parseChordPro(MESSY));
    const misplaced = found.find((s) => s.raw === 'Cm#');
    expect(misplaced?.fixed).toBe('C#m');
    expect(misplaced?.reason).toMatch(/accidental/);
  });

  it('proposes a minor chord for a lowercase root', () => {
    const found = auditSong(parseChordPro(MESSY));
    expect(found.find((s) => s.raw === 'g')?.fixed).toBe('Gm');
  });

  it('carries the lyric line, so a reviewer sees the chord in place', () => {
    expect(auditSong(parseChordPro(MESSY))[0]!.context).toBe('Eu Te iubesc, mila Ta');
  });

  it('says nothing about a song that is already right', () => {
    expect(auditSong(parseChordPro(CLEAN))).toEqual([]);
  });
});

describe('auditing the library', () => {
  it('groups by spelling, so the scale is legible before the detail', () => {
    writeSong('a.chopro', MESSY);
    writeSong('b.chopro', MESSY.replace('id-1', 'id-3').replace('Cu spelling ciudat', 'Altul'));
    writeSong('c.chopro', CLEAN);
    library.reindex();

    const audit = auditLibrary(library);
    expect(audit.songsAffected).toBe(2);
    expect(audit.spellings.find((s) => s.raw === 'Cm#')?.count).toBe(2);
    expect(audit.chordsScanned).toBe(6);
  });
});

describe('applying reviewed fixes', () => {
  beforeEach(() => {
    writeSong('a.chopro', MESSY);
    library.reindex();
  });

  it('changes only the chords it was given', () => {
    const [first] = auditLibrary(library).suggestions.filter((s) => s.raw === 'Cm#');
    const result = applyFixes(library, [
      {
        songId: first!.songId,
        blockId: first!.blockId,
        lineIndex: first!.lineIndex,
        at: first!.at,
        layer: first!.layer,
        raw: 'Cm#',
        fixed: 'C#m',
      },
    ]);
    expect(result).toMatchObject({ songs: 1, chords: 1, stale: 0 });

    const song = library.get(first!.songId)!;
    const chords = song.blocks[0]!.lines[0]!.chords.map((c) => c.raw);
    // The lowercase `g` was not in the fix list, so it must be untouched.
    expect(chords).toEqual(['C#m', 'g']);
  });

  it('refuses a fix whose chord has changed since it was reviewed', () => {
    const [first] = auditLibrary(library).suggestions;
    const result = applyFixes(library, [
      {
        songId: first!.songId,
        blockId: first!.blockId,
        lineIndex: first!.lineIndex,
        at: first!.at,
        layer: first!.layer,
        raw: 'SomethingElse',
        fixed: 'C#m',
      },
    ]);
    expect(result).toMatchObject({ songs: 0, chords: 0, stale: 1 });
  });

  it('writes each song once, so the whole cleanup is one undo', () => {
    const suggestions = auditLibrary(library).suggestions;
    expect(suggestions).toHaveLength(2);
    applyFixes(
      library,
      suggestions.map((s) => ({
        songId: s.songId,
        blockId: s.blockId,
        lineIndex: s.lineIndex,
        at: s.at,
        layer: s.layer,
        raw: s.raw,
        fixed: s.fixed,
      })),
    );
    // One revision snapshot, not two — the previous state is recoverable in one step.
    expect(library.revisions('id-1')).toHaveLength(1);
  });

  it('survives a song that was deleted between review and apply', () => {
    const result = applyFixes(library, [
      {
        songId: 'gone',
        blockId: 'V1',
        lineIndex: 0,
        at: 0,
        layer: 'chords',
        raw: 'g',
        fixed: 'G',
      },
    ]);
    expect(result.stale).toBe(1);
  });
});
