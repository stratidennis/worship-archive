/**
 * Editing operations.
 *
 * All pure and immutable: every function returns a new value and mutates nothing. That
 * is what makes undo/redo a matter of keeping a list of snapshots rather than a system
 * of inverse operations, and it is why the live preview can render the next state
 * without the editor having committed to it.
 */

import {
  BLOCK_ID_PREFIX,
  emptyBlock,
  emptyLine,
  type Anchor,
  type Block,
  type BlockType,
  type Line,
  type Song,
} from './types.js';

/**
 * Move chord anchors to follow an edit to the lyric text.
 *
 * This is the one piece of the editor that can quietly ruin a song. Typing a word at
 * the start of a line must carry every chord along with it; deleting a chunk must not
 * leave chords pointing past the end, or stranded in the middle of a word they were
 * never on.
 *
 * The edit is located by common prefix and suffix, which is exactly right for how
 * people actually type — one insertion or deletion at one place. Anchors before the
 * change stay put, anchors after it shift by the length delta, and anchors inside a
 * deleted span collapse to where that span began rather than being dropped, because
 * losing a chord is worse than misplacing one by a few characters.
 */
export function shiftAnchors(oldText: string, newText: string, anchors: Anchor[]): Anchor[] {
  if (oldText === newText || anchors.length === 0) return anchors;

  // Nothing was there for a chord to be attached to, so it stays at the start rather
  // than being dragged to the end of whatever gets typed.
  if (oldText.length === 0) return anchors.map((a) => ({ ...a, at: 0 }));

  let prefix = 0;
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removedEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;

  return anchors.map((anchor) => {
    let at: number;
    // Strictly before the edit. An anchor *at* the edit point moves: the chord belongs
    // to the syllable it was placed on, and inserting text pushes that syllable along.
    // Typing "iu" into "Eu |besc" must carry the chord on "besc" with it.
    if (anchor.at < prefix) at = anchor.at;
    else if (anchor.at >= removedEnd) at = anchor.at + delta;
    else at = prefix;
    return { ...anchor, at: Math.max(0, Math.min(at, newText.length)) };
  });
}

/** Replace a line's text, carrying its chords and bass notes with the edit. */
export function setLineText(line: Line, text: string): Line {
  return {
    ...line,
    text,
    chords: shiftAnchors(line.text, text, line.chords),
    bass: shiftAnchors(line.text, text, line.bass),
  };
}

/** Add or replace a chord at a position. An empty value removes it. */
export function setChord(
  line: Line,
  at: number,
  raw: string,
  layer: 'chords' | 'bass' = 'chords',
): Line {
  const anchors = line[layer].filter((a) => a.at !== at);
  const next = raw.trim() === '' ? anchors : [...anchors, { at, raw: raw.trim() }];
  return { ...line, [layer]: next.sort((a, b) => a.at - b.at) };
}

export function removeChord(line: Line, at: number, layer: 'chords' | 'bass' = 'chords'): Line {
  return { ...line, [layer]: line[layer].filter((a) => a.at !== at) };
}

/** The next unused block id for a type: V1, V2, C1… */
export function nextBlockId(song: Song, type: BlockType): string {
  const prefix = BLOCK_ID_PREFIX[type];
  const used = new Set(song.blocks.map((b) => b.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function updateBlock(song: Song, blockId: string, patch: Partial<Block>): Song {
  return {
    ...song,
    blocks: song.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
  };
}

export function updateLine(
  song: Song,
  blockId: string,
  lineIndex: number,
  update: (line: Line) => Line,
): Song {
  return {
    ...song,
    blocks: song.blocks.map((block) =>
      block.id === blockId
        ? { ...block, lines: block.lines.map((l, i) => (i === lineIndex ? update(l) : l)) }
        : block,
    ),
  };
}

export function insertBlock(song: Song, type: BlockType, afterIndex?: number): Song {
  const block = emptyBlock(nextBlockId(song, type), type);
  block.lines = [emptyLine('')];
  const at = afterIndex === undefined ? song.blocks.length : afterIndex + 1;
  const blocks = [...song.blocks.slice(0, at), block, ...song.blocks.slice(at)];
  return { ...song, blocks };
}

export function removeBlock(song: Song, blockId: string): Song {
  return {
    ...song,
    blocks: song.blocks.filter((b) => b.id !== blockId),
    // An arrangement that still references a deleted block would render nothing at
    // that point, silently shortening the song.
    arrangement: song.arrangement?.filter((id) => id !== blockId) ?? null,
  };
}

export function moveBlock(song: Song, blockId: string, direction: -1 | 1): Song {
  const index = song.blocks.findIndex((b) => b.id === blockId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= song.blocks.length) return song;
  const blocks = [...song.blocks];
  const [moved] = blocks.splice(index, 1);
  blocks.splice(target, 0, moved!);
  return { ...song, blocks };
}

export function insertLine(song: Song, blockId: string, afterIndex: number): Song {
  return {
    ...song,
    blocks: song.blocks.map((block) =>
      block.id === blockId
        ? {
            ...block,
            lines: [
              ...block.lines.slice(0, afterIndex + 1),
              emptyLine(''),
              ...block.lines.slice(afterIndex + 1),
            ],
          }
        : block,
    ),
  };
}

export function removeLine(song: Song, blockId: string, lineIndex: number): Song {
  return {
    ...song,
    blocks: song.blocks.map((block) =>
      block.id === blockId
        ? { ...block, lines: block.lines.filter((_, i) => i !== lineIndex) }
        : block,
    ),
  };
}

/**
 * Split a block at a line, so the second half becomes a new block of the same type.
 *
 * Useful when a verse was typed as one long block and needs separating.
 */
export function splitBlock(song: Song, blockId: string, atLine: number): Song {
  const index = song.blocks.findIndex((b) => b.id === blockId);
  const block = song.blocks[index];
  if (!block || atLine <= 0 || atLine >= block.lines.length) return song;

  const head: Block = { ...block, lines: block.lines.slice(0, atLine) };
  const tail: Block = {
    ...block,
    id: nextBlockId(song, block.type),
    lines: block.lines.slice(atLine),
  };
  const blocks = [...song.blocks];
  blocks.splice(index, 1, head, tail);
  return { ...song, blocks };
}

/** Merge a block into the one before it. */
export function mergeBlockUp(song: Song, blockId: string): Song {
  const index = song.blocks.findIndex((b) => b.id === blockId);
  const previous = song.blocks[index - 1];
  const block = song.blocks[index];
  if (!previous || !block) return song;

  const merged: Block = { ...previous, lines: [...previous.lines, ...block.lines] };
  const blocks = [...song.blocks];
  blocks.splice(index - 1, 2, merged);
  return {
    ...song,
    blocks,
    arrangement: song.arrangement?.filter((id) => id !== blockId) ?? null,
  };
}

/** True when a song has nothing worth saving yet. */
export function isEmptySong(song: Song): boolean {
  return (
    song.title.trim() === '' &&
    song.blocks.every((b) =>
      b.lines.every((l) => l.text.trim() === '' && l.chords.length === 0),
    )
  );
}

/**
 * Paste text into a line, splitting it wherever the source had a line break.
 *
 * Lyrics are almost always copied from somewhere — a document, a website, a message —
 * and they arrive as several lines. Flattening them into one and making someone press
 * Enter in the right twenty places is busywork the machine can do.
 *
 * The chords are the delicate part. Anchors before the cursor belong to the first
 * line and do not move; anchors after it belong to the *last* line, shifted by however
 * much text now precedes them there. Getting this wrong silently moves chords onto the
 * wrong syllables, which is the kind of mistake nobody notices until a service.
 */
export function pasteIntoLine(line: Line, at: number, text: string): Line[] {
  const cursor = Math.max(0, Math.min(at, line.text.length));
  const chunks = text.replace(/\r\n?/g, '\n').split('\n');
  const before = line.text.slice(0, cursor);
  const after = line.text.slice(cursor);

  // A single line of text is an ordinary edit; `setLineText` already shifts anchors.
  if (chunks.length === 1) {
    return [setLineText(line, before + chunks[0] + after)];
  }

  const first = chunks[0] ?? '';
  const last = chunks[chunks.length - 1] ?? '';

  const keep = (anchors: Anchor[]): Anchor[] => anchors.filter((a) => a.at <= cursor);
  const move = (anchors: Anchor[]): Anchor[] =>
    anchors
      .filter((a) => a.at > cursor)
      .map((a) => ({ ...a, at: a.at - cursor + last.length }));

  const head: Line = {
    ...line,
    text: before + first,
    chords: keep(line.chords),
    bass: keep(line.bass),
  };

  const middle = chunks.slice(1, -1).map((chunk) => ({
    ...emptyLine(chunk),
    singers: line.singers,
    indent: line.indent,
    color: line.color,
  }));

  const tail: Line = {
    ...emptyLine(last + after),
    singers: line.singers,
    indent: line.indent,
    color: line.color,
    chords: move(line.chords),
    bass: move(line.bass),
  };

  return [head, ...middle, tail];
}

/** Replace one line with several — what a multi-line paste produces. */
export function replaceLine(
  song: Song,
  blockId: string,
  lineIndex: number,
  lines: Line[],
): Song {
  return {
    ...song,
    blocks: song.blocks.map((block) =>
      block.id === blockId
        ? {
            ...block,
            lines: [
              ...block.lines.slice(0, lineIndex),
              ...lines,
              ...block.lines.slice(lineIndex + 1),
            ],
          }
        : block,
    ),
  };
}

/**
 * Replace one editor block with parsed blocks from a structured paste.
 *
 * The blocks before and after the paste target are left alone. Imported ids are kept
 * when possible and made unique when the song already has (for example) a `C1`.
 * Changing the section structure invalidates an authored arrangement, so it is cleared
 * rather than leaving references to blocks that no longer exist.
 */
export function replaceBlockWithBlocks(song: Song, blockId: string, incoming: Block[]): Song {
  const index = song.blocks.findIndex((block) => block.id === blockId);
  if (index === -1 || incoming.length === 0) return song;

  const used = new Set(
    song.blocks.filter((block) => block.id !== blockId).map((block) => block.id),
  );
  const blocks = incoming.map((block) => {
    if (!used.has(block.id)) {
      used.add(block.id);
      return block;
    }
    const prefix = BLOCK_ID_PREFIX[block.type];
    let number = 1;
    while (used.has(`${prefix}${number}`)) number++;
    const id = `${prefix}${number}`;
    used.add(id);
    return { ...block, id };
  });

  return {
    ...song,
    blocks: [...song.blocks.slice(0, index), ...blocks, ...song.blocks.slice(index + 1)],
    arrangement: null,
  };
}
