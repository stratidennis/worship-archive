import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyBlock, emptyLine, type BlockType, type Song } from '@worship/core';
import {
  createPowerPoint,
  findPowerPoints,
  firstAudienceLine,
  generatedPowerPointName,
  lyricFontSize,
} from '../src/powerpoints.js';

let dir: string;

function song(blocks: { type: BlockType; lines: string[] }[], title = 'Ce mare ești Tu'): Song {
  return {
    id: 'song-1',
    legacyUuid: null,
    title,
    writtenKey: 'G',
    performanceKey: 'G',
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: blocks.map(({ type, lines }, index) => ({
      ...emptyBlock(`${type[0]}${index + 1}`, type),
      lines: lines.map(emptyLine),
    })),
    arrangement: null,
    lang: 'ro',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-powerpoints-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('PowerPoint names and matching', () => {
  it('uses a diacritic-free first lyric and title when they differ', () => {
    const value = song([{ type: 'Verse', lines: ['Splendoare de-mpărat'] }]);
    expect(generatedPowerPointName(value)).toBe('Splendoare de-mparat — Ce mare esti Tu.pptx');
  });

  it('finds an existing presentation recursively by its first lyric', () => {
    const nested = join(dir, '2026', 'Sunday');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'Splendoare de-mparat.pptx'), 'existing');
    const value = song([{ type: 'Verse', lines: ['Splendoare de-mpărat'] }]);
    const result = findPowerPoints(dir, [value]).results[0]!;
    expect(result.status).toBe('found');
    expect(result.file?.relativePath).toContain(join('2026', 'Sunday'));
  });

  it('prefers the first verse over notes and introductions', () => {
    const value = song([
      { type: 'Note', lines: ['Refren x2'] },
      { type: 'Intro', lines: ['D G A'] },
      { type: 'Chorus', lines: ['Ce mare ești Tu'] },
      { type: 'Verse', lines: ['Splendoare de-mpărat'] },
    ]);
    expect(firstAudienceLine(value)).toBe('Splendoare de-mpărat');
  });
});

describe('PowerPoint generation', () => {
  it('creates a real pptx package for audience blocks', async () => {
    const value = song([
      { type: 'Verse', lines: ['Splendoare de-mpărat', 'În măreția Ta'] },
      { type: 'Note', lines: ['Doar pentru trupă'] },
      { type: 'Chorus', lines: ['Ce mare ești Tu'] },
    ]);
    const file = await createPowerPoint(dir, value);
    const full = join(dir, file.relativePath);
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full).subarray(0, 2).toString()).toBe('PK');
    expect(readFileSync(full).byteLength).toBeGreaterThan(10_000);
  });

  it('uses smaller text only when rows need it', () => {
    expect(lyricFontSize(['Short line'])).toBe(52);
    expect(lyricFontSize(['A line '.repeat(14)])).toBeLessThan(30);
  });

  it('refuses to make an empty audience presentation', async () => {
    const value = song([{ type: 'Note', lines: ['Band note'] }]);
    await expect(createPowerPoint(dir, value)).rejects.toThrow('has no Verse');
  });
});
