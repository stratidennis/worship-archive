import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { emptyBlock, emptyLine, parseChordPro, type Song } from '@worship/core';
import { generatePowerPoint, presentationPages } from '../src/powerpoints.js';
import { writePresentation } from '../src/presentation-write.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open) };
});

const example = (): Song =>
  ({
    id: 's',
    title: 'Song',
    blocks: [
      { ...emptyBlock('V1', 'Verse'), lines: [emptyLine('One'), emptyLine('Two')], repeat: 2 },
    ],
    arrangement: null,
  }) as Song;

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const directory = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'export-'));
  dirs.push(dir);
  return dir;
};

it.each([2, 3, 4])(
  'writes compact x%i and expanded editable lyrics into OOXML',
  async (count) => {
    const song = example();
    song.blocks[0]!.repeat = count;
    const original = JSON.stringify(song);
    for (const repeatMode of ['compact', 'expanded'] as const) {
      const zip = await JSZip.loadAsync(await generatePowerPoint(song, { repeatMode }));
      const slides = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name),
      );
      const text = await Promise.all(
        slides.map(async (name) => {
          const xml = await zip.file(name)!.async('string');
          expect(xml).toContain('FFFFFF');
          expect(xml).not.toContain('<p:pic>');
          return [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => m[1]).join('\n');
        }),
      );
      expect(text).toEqual(
        repeatMode === 'compact'
          ? [`/: One\nTwo :/${count > 2 ? ' x' + count : ''}`]
          : Array(count).fill('One\nTwo'),
      );
    }
    expect(JSON.stringify(song)).toBe(original);
  },
);

it('marks the whole multi-slide section, preserving A–B–A–B meaning', () => {
  const song = example();
  song.blocks[0]!.lines = Array.from({ length: 8 }, (_, i) => emptyLine('Lyric ' + i));
  const compact = presentationPages(song, { repeatMode: 'compact' });
  expect(compact).toEqual([
    ['/: Lyric 0', 'Lyric 1', 'Lyric 2', 'Lyric 3'],
    ['Lyric 4', 'Lyric 5', 'Lyric 6', 'Lyric 7 :/'],
  ]);
  expect(presentationPages(song)).toEqual(
    Array(2)
      .fill(song.blocks[0]!.lines.map((l) => l.text))
      .flatMap((lines) => [lines.slice(0, 4), lines.slice(4)]),
  );
});

it('preserves reviewed order, deduplicates metadata, and keeps distinct identities and chorus returns', () => {
  const song = example();
  song.blocks.push({
    ...emptyBlock('C1', 'Chorus'),
    lines: [emptyLine('One'), emptyLine('Two')],
  });
  song.arrangementSource = 'reviewed';
  song.arrangement = ['V1', 'V1', 'C1', 'V1', 'C1'];
  expect(presentationPages(song, { repeatMode: 'compact' })).toEqual([
    ['/: One', 'Two :/'],
    ['One', 'Two'],
    ['One', 'Two'],
    ['One', 'Two'],
  ]);
});

it('expands partial inline repeats and rejects ambiguous instructions before writing', async () => {
  const song = example();
  song.blocks[0]!.repeat = null;
  song.blocks[0]!.lines = [
    emptyLine('Before'),
    emptyLine('/: Middle :/ x3'),
    emptyLine('After'),
  ];
  expect(presentationPages(song, { repeatMode: 'compact' })).toEqual([
    ['Before', 'Middle', 'Middle', 'Middle', 'After'],
  ]);
  song.blocks.push({ ...emptyBlock('N1', 'Note'), lines: [emptyLine('repeat chorus later')] });
  await expect(generatePowerPoint(song)).rejects.toThrow('Review');
});

it.each([
  ['/:', ':/'],
  ['/:', '/:'],
  ['%', '%'],
])('keeps a separate lyric row after an unnumbered %s … %s repeat', (open, close) => {
  const song = example();
  song.blocks[0]!.repeat = null;
  song.blocks[0]!.lines = ['Before', `${open} Sing`, `With joy ${close}`, 'After'].map(
    emptyLine,
  );
  expect(presentationPages(song)).toEqual([
    ['Before', 'Sing', 'With joy', 'Sing', 'With joy', 'After'],
  ]);
});

it('counts only complete lyric rows as already-expanded copies', () => {
  const song = example();
  song.blocks[0]!.repeat = null;
  song.blocks[0]!.lines = ['Before', '/: Sing :/ x2', 'Sing praises'].map(emptyLine);
  expect(presentationPages(song)).toEqual([['Before', 'Sing', 'Sing', 'Sing praises']]);
});

it('exports a repeated ending cue followed by a numbered chorus return', async () => {
  const song = parseChordPro(`{title: Ending cue}
{soc: C1}
First chorus
{eoc}
{soc: C2}
Second chorus
Worthy, Jesus, worthy
All the glory is Yours
You are worthy
{eoc}
{sov: V1}
Last verse
{eov}
{x_type: Note}
{sov: M1}
Ref 1
{eov}
{x_type: Ending}
{sov: M2}
Final: Worthy x 2
Ref 2
{eov}`);
  const original = JSON.stringify(song);
  const ending = ['Worthy, Jesus, worthy', 'All the glory is Yours', 'You are worthy'];
  const secondChorus = ['Second chorus', ...ending];
  const opening = [['First chorus'], secondChorus, ['Last verse'], ['First chorus']];
  expect(presentationPages(song)).toEqual([...opening, ending, ending, secondChorus]);

  const zip = await JSZip.loadAsync(await generatePowerPoint(song, { repeatMode: 'compact' }));
  const slides = await Promise.all(
    zip.file(/^ppt\/slides\/slide\d+\.xml$/).map((slide) => slide.async('string')),
  );
  expect(
    slides.map((xml) => [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((match) => match[1])),
  ).toEqual([
    ...opening,
    ['/: Worthy, Jesus, worthy', 'All the glory is Yours', 'You are worthy :/'],
    secondChorus,
  ]);
  expect(JSON.stringify(song)).toBe(original);
});

it('expands a sung ending with a trailing repeat count and validates its bounds', () => {
  const song = example();
  song.blocks = [{ ...emptyBlock('E1', 'Ending'), lines: [emptyLine('Final: Forever x3')] }];
  expect(presentationPages(song)).toEqual([['Forever'], ['Forever'], ['Forever']]);
  song.blocks[0]!.lines = [emptyLine('Final: Forever x21')];
  expect(() => presentationPages(song)).toThrow('E1: unsupported repeat count 21');
});

it('publishes complete packages with no-clobber collisions and explicit replacement', async () => {
  const dir = await directory(),
    target = join(dir, 'song.pptx');
  const data = await generatePowerPoint(example());
  const results = await Promise.allSettled([
    writePresentation(target, data, false),
    writePresentation(target, data, false),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(await readFile(target)).toEqual(data);
  await writeFile(target, 'manual edits');
  await expect(writePresentation(target, Buffer.from('broken'), true)).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('manual edits');
  await writePresentation(target, data, true);
  expect(await readFile(target)).toEqual(data);
  expect(await readdir(dir)).toEqual(['song.pptx']);
});

it.each(['EBUSY', 'EPERM', 'EACCES', 'EIO'])(
  'preserves originals and cleans temp files when replacement fails with %s',
  async (code) => {
    const dir = await directory(),
      target = join(dir, 'song.pptx');
    await writeFile(target, 'original');
    const data = await generatePowerPoint(example());
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('failed'), { code }));
    await expect(writePresentation(target, data, true)).rejects.toThrow(
      code === 'EIO' ? 'failed' : 'Close it',
    );
    expect(await readFile(target, 'utf8')).toBe('original');
    expect(await readdir(dir)).toEqual(['song.pptx']);
  },
);

it('cleans temporary files after a failed write', async () => {
  const dir = await directory(),
    target = join(dir, 'song.pptx');
  const data = await generatePowerPoint(example());
  const realOpen = (await vi.importActual<typeof FsPromises>('node:fs/promises')).open;
  vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
    const handle = await realOpen(...args);
    vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    return handle;
  });
  await expect(writePresentation(target, data, false)).rejects.toThrow('disk full');
  expect(await readdir(dir)).toEqual([]);
});

it.runIf(process.platform === 'win32')(
  'retains a file locked by a real Windows application',
  async () => {
    const { spawn } = await import('node:child_process');
    const dir = await directory(),
      target = join(dir, 'locked.pptx');
    await writeFile(target, 'manual edits');
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "$f = [System.IO.File]::Open($env:WORSHIP_LOCK_TARGET, 'Open', 'ReadWrite', 'Read'); [Console]::WriteLine('READY'); [Console]::ReadLine() | Out-Null; $f.Dispose()",
      ],
      { env: { ...process.env, WORSHIP_LOCK_TARGET: target }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error('Lock process exited: ' + code)));
        child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('READY')) resolve();
        });
      });
      await expect(
        writePresentation(target, await generatePowerPoint(example()), true),
      ).rejects.toThrow('Close it');
      expect(await readFile(target, 'utf8')).toBe('manual edits');
      expect(await readdir(dir)).toEqual(['locked.pptx']);
    } finally {
      child.stdin.end('\n');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  },
  15000,
);
