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
  comparableName,
  findPowerPoints,
  firstAudienceLine,
  generatedPowerPointName,
  lyricFontSize,
  lyricLineSpacing,
  presentationMimeType,
  resolvePowerPointFile,
  slideGroups,
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

  it.each(["Ceru'ntreg a plans.pptx", 'Ceruntreg a plans.pptx', 'Ceru-ntreg a plans.pptx'])(
    'finds contracted Romanian first lyrics: %s',
    (name) => {
      writeFileSync(join(dir, name), 'existing');
      const value = song([{ type: 'Verse', lines: ['Ceru-ntreg a plâns'] }], 'La cruce');
      expect(findPowerPoints(dir, [value]).results[0]!.file?.name).toBe(name);
    },
  );

  it('finds the source opening lyric even when a reviewed set starts with another verse', () => {
    writeFileSync(join(dir, 'Ceru-ntreg a plans.pptx'), 'existing');
    const value = song(
      [
        { type: 'Verse', lines: ['Ceru-ntreg a plâns'] },
        { type: 'Verse', lines: ['O altă strofă'] },
      ],
      'La cruce',
    );
    value.arrangement = [value.blocks[1]!.id];
    value.arrangementSource = 'reviewed';
    expect(findPowerPoints(dir, [value]).results[0]!.status).toBe('found');
  });

  it('finds Ceru-ntreg a plans after a leading intro instruction', () => {
    writeFileSync(join(dir, 'Ceru-ntreg a plans.pptx'), 'existing');
    const value = song(
      [
        { type: 'Note', lines: ['Intro: pian'] },
        { type: 'Verse', lines: ['[Intro: pian]', 'Ceru-ntreg a plâns', 'La crucea Ta'] },
      ],
      'La cruce',
    );
    expect(findPowerPoints(dir, [value]).results[0]!.file?.name).toBe(
      'Ceru-ntreg a plans.pptx',
    );
  });

  it('does not match unrelated short filenames just because their letters occur in a lyric', () => {
    writeFileSync(join(dir, 'A.pptx'), 'unrelated');
    const value = song([{ type: 'Verse', lines: ['Ceru-ntreg a plâns'] }], 'La cruce');
    expect(findPowerPoints(dir, [value]).results[0]!.status).toBe('missing');
  });

  it('finds an ODP presentation and matches its title without the extension', () => {
    const nested = join(dir, 'OpenDocument');
    mkdirSync(nested);
    writeFileSync(join(nested, 'Ce mare esti Tu.ODP'), 'existing');
    const value = song([{ type: 'Verse', lines: ['Splendoare de-mpărat'] }]);
    const result = findPowerPoints(dir, [value]).results[0]!;
    expect(result.status).toBe('found');
    expect(result.file?.relativePath).toBe(join('OpenDocument', 'Ce mare esti Tu.ODP'));
  });

  it('recognizes supported slide formats but not unrelated files', () => {
    for (const extension of [
      'ppt',
      'pptx',
      'pptm',
      'pps',
      'ppsx',
      'ppsm',
      'pot',
      'potx',
      'potm',
      'odp',
      'otp',
      'fodp',
      'key',
      'sxi',
      'dps',
      'dpt',
    ]) {
      const name = `Example.${extension.toUpperCase()}`;
      writeFileSync(join(dir, name), 'presentation');
      expect(resolvePowerPointFile(dir, name)).toBe(join(dir, name));
      expect(comparableName(name)).toBe('example');
    }
    writeFileSync(join(dir, 'Example.pdf'), 'unrelated');
    expect(resolvePowerPointFile(dir, 'Example.pdf')).toBeNull();
  });

  it('uses the original presentation format for browser downloads', () => {
    expect(presentationMimeType('Example.ODP')).toBe(
      'application/vnd.oasis.opendocument.presentation',
    );
    expect(presentationMimeType('Example.ppsx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    );
    expect(presentationMimeType('Example.key')).toBe('application/vnd.apple.keynote');
    expect(presentationMimeType('Example.dps')).toBe('application/octet-stream');
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

  it('balances a seven-line block instead of leaving one line alone', () => {
    const lines = [
      'In Tine ma incred',
      'Prin harul Tau traiesc',
      'Renunt la ce sunt eu',
      'Ma supun a ce voiesti',
      'A vieti ancora',
      'Tata Tu esti neschimbat',
      'Te ador, Te iubesc',
    ];
    expect(slideGroups(lines).map((page) => page.length)).toEqual([4, 3]);
    expect(slideGroups(lines).flat()).toEqual(lines);
  });

  it('turns the slide at an authored repeat ending when a long block is split', () => {
    const lines = [
      '/:De-i lupta-ncrâncenată',
      'Și vin săgeți arzând',
      'Nu tremur nu mi-e teamă',
      'Știu lângă cine lupt :/ x3',
      'De-i lupta-ncrâncenată',
      'Şi vin săgeţi arzând',
      'Nu tremur nu mi-e teamă',
    ];
    expect(slideGroups(lines)).toEqual([lines.slice(0, 4), lines.slice(4)]);
  });

  it('adds breathing room when four long rows require smaller text', () => {
    const lines = [
      'Mantuitorul, Prieten constant esti aici',
      'Tata din ceruri, Tu m-ai primit esti aici',
      'Esti pacea-n furtuni,un glas ce ma cheama',
      'Sa inaintez, stiind ca sustii lumea mea',
    ];
    const fontSize = lyricFontSize(lines);
    expect(fontSize).toBeLessThan(44);
    expect(lyricLineSpacing(lines, fontSize)).toBe(1.35);
  });

  it('refuses to make an empty audience presentation', async () => {
    const value = song([{ type: 'Note', lines: ['Band note'] }]);
    await expect(createPowerPoint(dir, value)).rejects.toThrow('has no Verse');
  });
});

// Inspect what editors actually inherit, including the unused blank layout that
// PptxGenJS includes alongside its public named master/layout.
describe('exported OOXML inheritance', () => {
  it('links black masters and every black layout with white editable defaults', async () => {
    const { default: JSZip } = await import('jszip');
    const value = song([
      { type: 'Verse', lines: ['1. Sing 1000 praises!', 'G Am D', '[Band only]'] },
      { type: 'Chorus', lines: ['Refren: Holy, holy!'] },
      { type: 'Verse', lines: ['Second verse'] },
      { type: 'Ending', lines: ['Final: Forever!'] },
    ]);
    const file = await createPowerPoint(dir, value);
    const zip = await JSZip.loadAsync(readFileSync(join(dir, file.relativePath)));
    const parts = Object.keys(zip.files);
    const masters = parts.filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p));
    const layouts = parts.filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p));
    expect(masters.length).toBeGreaterThan(0);
    expect(layouts.length).toBeGreaterThanOrEqual(2);
    for (const part of [...masters, ...layouts]) {
      const xml = await zip.file(part)!.async('string');
      expect(xml).toMatch(/<p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"/);
      if (masters.includes(part)) {
        expect(xml).toContain('bg1="dk1" tx1="lt1"');
        expect(xml).toContain('<a:defRPr sz="5200" b="1"><a:solidFill><a:srgbClr val="FFFFFF"');
      }
      const rels = await zip
        .file(part.replace(/\/([^/]+)$/, '/_rels/$1.rels'))!
        .async('string');
      expect(rels).toContain(masters.includes(part) ? '/slideLayout"' : '/slideMaster"');
      for (const target of rels.matchAll(/Target="([^"#]+)"/g)) {
        const { posix } = await import('node:path');
        expect(
          zip.file(posix.normalize(posix.join(posix.dirname(part), target[1]!))),
        ).not.toBeNull();
      }
    }
    const slides = parts
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]));
    const texts: string[] = [];
    for (const part of slides) {
      const xml = await zip.file(part)!.async('string');
      texts.push([...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => m[1]).join('\n'));
      expect(xml).toContain('<a:srgbClr val="000000"');
      expect(xml).toContain('<a:srgbClr val="FFFFFF"');
      expect(xml).toContain('typeface="Arial"');
      expect(xml).toContain('<a:off x="530352" y="411480"/>');
      expect(xml).toContain('<a:ext cx="11128248" cy="6035040"/>');
      expect(xml).not.toContain('<p:pic>');
      const rels = await zip
        .file(part.replace(/\/([^/]+)$/, '/_rels/$1.rels'))!
        .async('string');
      expect(rels).toContain('/slideLayout"');
    }
    expect(texts).toEqual([
      'Sing 1000 praises!',
      'Holy, holy!',
      'Second verse',
      'Holy, holy!',
      'Forever!',
    ]);
    const presentation = await zip.file('ppt/presentation.xml')!.async('string');
    expect(presentation).toContain('cx="12192000" cy="6858000"');
    expect(presentation).toContain('<a:srgbClr val="FFFFFF"');
  });

  it('does not overwrite an existing presentation', async () => {
    const value = song([{ type: 'Verse', lines: ['Keep existing'] }]);
    const name = generatedPowerPointName(value);
    writeFileSync(join(dir, name), 'user presentation');
    await createPowerPoint(dir, value);
    expect(readFileSync(join(dir, name), 'utf8')).toBe('user presentation');
  });
});

it('carries reviewed set orders through the desktop HTTP API without saving them', async () => {
  const { Library } = await import('../src/library.js');
  const { SetStore } = await import('../src/sets.js');
  const { createServer } = await import('../src/api.js');
  const { default: JSZip } = await import('jszip');
  const library = new Library(join(dir, 'library'));
  const sets = new SetStore(join(dir, 'library'), library.db);
  const value = song([
    { type: 'Verse', lines: ['Verse lyric'] },
    { type: 'Chorus', lines: ['Chorus lyric'] },
  ]);
  library.save(value);
  const original = library.get(value.id);
  const app = createServer({ library, sets, powerpointsDir: join(dir, 'decks') });
  try {
    const order = [value.blocks[1]!.id, value.blocks[0]!.id];
    const response = await app.inject({
      method: 'POST',
      url: '/api/powerpoints/create',
      payload: { songIds: [value.id], arrangements: { [value.id]: order } },
    });
    expect(response.statusCode).toBe(200);
    const file = response.json().results[0].file.relativePath as string;
    const zip = await JSZip.loadAsync(readFileSync(join(dir, 'decks', file)));
    const texts = [];
    for (const part of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
      const xml = await zip.file(part)!.async('string');
      texts.push([...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => m[1]).join('\n'));
    }
    expect(texts).toEqual(['Chorus lyric', 'Verse lyric']);
    expect(library.get(value.id)).toEqual(original);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/powerpoints/create',
      payload: { songIds: [value.id], arrangements: { [value.id]: ['UNKNOWN'] } },
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await app.close();
    library.close();
  }
});
