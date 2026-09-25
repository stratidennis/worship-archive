/**
 * PowerPoint discovery and generation.
 *
 * The configured folder is intentionally separate from the song library. Churches
 * often keep presentations on a shared drive with years of subfolders, and moving
 * those files into Worship Archive would make the feature far less useful. We scan the
 * whole tree, match both the song title and its first audience lyric, and expose only
 * relative paths to clients.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { Block, Song } from '@worship/core';

const POWERPOINT_EXTENSIONS = new Set(['.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.ppsm']);
const AUDIENCE_BLOCKS = new Set(['Verse', 'Chorus', 'Bridge']);

export interface PowerPointFile {
  name: string;
  relativePath: string;
}

export interface PowerPointSongResult {
  songId: string;
  title: string;
  firstLine: string | null;
  status: 'found' | 'missing';
  file: PowerPointFile | null;
}

export interface PowerPointReport {
  folder: string;
  results: PowerPointSongResult[];
}

/** Remove accents, punctuation and file extensions for tolerant comparisons. */
export function comparableName(value: string): string {
  return value
    .replace(/\.(?:ppt|pptx|pptm|pps|ppsx|ppsm)$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function audienceBlocks(song: Song): Block[] {
  const usable = new Map(
    song.blocks
      .filter((block) => AUDIENCE_BLOCKS.has(block.type) && !block.bandOnly)
      .map((block) => [block.id, block]),
  );
  if (!song.arrangement?.length) return [...usable.values()];
  return song.arrangement.flatMap((id) => {
    const block = usable.get(id);
    return block ? [block] : [];
  });
}

/** Prefer the first verse for naming, then fall back to the first audience block. */
export function firstAudienceLine(song: Song): string | null {
  const blocks = audienceBlocks(song);
  const firstVerse = blocks.find((block) => block.type === 'Verse');
  for (const block of firstVerse ? [firstVerse, ...blocks] : blocks) {
    const line = block.lines.map((one) => one.text.trim()).find(Boolean);
    if (line) return line;
  }
  return null;
}

function tokens(value: string): Set<string> {
  return new Set(
    comparableName(value)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

function tokenScore(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return (2 * intersection) / (a.size + b.size);
}

function matchScore(filename: string, candidates: string[]): number {
  const file = comparableName(filename);
  let score = 0;
  for (const candidate of candidates) {
    const wanted = comparableName(candidate);
    if (!wanted) continue;
    if (file === wanted) score = Math.max(score, 1);
    else if (wanted.length >= 5 && (file.includes(wanted) || wanted.includes(file))) {
      const shorter = Math.min(file.length, wanted.length);
      const longer = Math.max(file.length, wanted.length);
      score = Math.max(score, 0.82 + 0.16 * (shorter / longer));
    }
    score = Math.max(score, tokenScore(file, wanted) * 0.9);
  }
  return score;
}

function presentationFiles(root: string): PowerPointFile[] {
  const found: PowerPointFile[] = [];
  if (!existsSync(root)) return found;
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      // A removable drive or protected subfolder should not prevent all other
      // presentations from being found.
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('~$') || entry.name.startsWith('.')) continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        POWERPOINT_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())
      ) {
        found.push({ name: entry.name, relativePath: relative(root, full) });
      }
    }
  };
  walk(root);
  return found;
}

export function findPowerPoints(root: string, songs: Song[]): PowerPointReport {
  const absolute = resolve(root);
  const files = presentationFiles(absolute);
  return {
    folder: absolute,
    results: songs.map((song) => {
      const firstLine = firstAudienceLine(song);
      const candidates = [song.title, ...(firstLine ? [firstLine] : [])];
      const ranked = files
        .map((file) => ({ file, score: matchScore(file.name, candidates) }))
        .sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name));
      // A score of .72 requires most meaningful words to agree, while still allowing
      // additions such as "lyrics", a key name, or the combined generated filename.
      const match =
        ranked[0]?.score !== undefined && ranked[0].score >= 0.72 ? ranked[0].file : null;
      return {
        songId: song.id,
        title: song.title,
        firstLine,
        status: match ? 'found' : 'missing',
        file: match,
      };
    }),
  };
}

function safeFilenamePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replaceAll(/[\s\S]/g, (character) => (character.charCodeAt(0) < 32 ? '' : character))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
}

export function generatedPowerPointName(song: Song): string {
  const title = safeFilenamePart(song.title) || 'Untitled song';
  const firstLine = safeFilenamePart(firstAudienceLine(song) ?? '');
  if (!firstLine || comparableName(firstLine) === comparableName(title)) return `${title}.pptx`;
  return `${firstLine.slice(0, 70)} — ${title.slice(0, 70)}.pptx`;
}

function slideGroups(lines: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (current.length >= 6) {
      groups.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Estimate a large point size that keeps every authored lyric row on one line. */
export function lyricFontSize(lines: string[]): number {
  const longest = Math.max(1, ...lines.map((line) => [...line].length));
  const horizontal = Math.floor(850 / (longest * 0.52));
  const vertical = Math.floor(455 / (Math.max(lines.length, 1) * 1.22));
  return Math.max(22, Math.min(52, horizontal, vertical));
}

export async function createPowerPoint(root: string, song: Song): Promise<PowerPointFile> {
  const blocks = audienceBlocks(song);
  const pages = blocks.flatMap((block) =>
    slideGroups(block.lines.map((line) => line.text.trim()).filter(Boolean)),
  );
  if (pages.length === 0) {
    throw new Error(`“${song.title}” has no Verse, Chorus, or Bridge lyrics.`);
  }

  const absolute = resolve(root);
  mkdirSync(absolute, { recursive: true });
  const fileName = generatedPowerPointName(song);
  const filePath = join(absolute, fileName);
  // PptxGenJS is deliberately loaded only when a deck is actually created. Importing
  // it with the HTTP server would make every lightweight API process pay its startup
  // cost even when the feature is never used.
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Worship Archive';
  pptx.subject = song.title;
  pptx.title = song.title;
  pptx.company = 'Worship Archive';
  pptx.theme = {
    headFontFace: 'Arial',
    bodyFontFace: 'Arial',
  };

  for (const lines of pages) {
    const slide = pptx.addSlide();
    slide.background = { color: '000000' };
    const fontSize = lyricFontSize(lines);
    slide.addText(lines.join('\n'), {
      x: 0.58,
      y: 0.45,
      w: 12.17,
      h: 6.6,
      fontFace: 'Arial',
      fontSize,
      color: 'FFFFFF',
      bold: true,
      fit: 'shrink',
      breakLine: false,
      margin: 0,
      align: 'center',
      valign: 'middle',
      lineSpacingMultiple: 1.1,
      paraSpaceAfter: Math.max(4, Math.round(fontSize * 0.16)),
    });
  }

  await pptx.writeFile({ fileName: filePath, compression: true });
  return { name: basename(filePath), relativePath: relative(absolute, filePath) };
}

export async function createMissingPowerPoints(
  root: string,
  songs: Song[],
): Promise<PowerPointReport> {
  const before = findPowerPoints(root, songs);
  for (const result of before.results) {
    if (result.status !== 'missing') continue;
    const song = songs.find((one) => one.id === result.songId);
    if (song) await createPowerPoint(root, song);
  }
  return findPowerPoints(root, songs);
}

/** Resolve an API-supplied relative path without allowing it outside the folder. */
export function resolvePowerPointFile(root: string, candidate: string): string | null {
  const absoluteRoot = resolve(root);
  const full = resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, full);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || resolve(rel) === rel)
    return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  if (!POWERPOINT_EXTENSIONS.has(extname(full).toLocaleLowerCase())) return null;
  return full;
}
