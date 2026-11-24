/** Presentation-only interpretation. Never edits the source song or its notes. */
import {
  emptyLine,
  MAX_SECTION_REPEAT,
  parseChord,
  parseSectionReference,
  type Block,
  type SectionReference,
  type Song,
} from '@worship/core';
import { parseArrangementText } from '@worship/importers';
import {
  expandLyricRepeats,
  normalizeRepeatMarks,
  parseRepeatSpans,
  TRAILING_REPEAT,
} from './lyric-repeats.js';

const SUNG = new Set(['Verse', 'Chorus', 'PreChorus', 'Bridge', 'Ending', 'Tag']);
export interface PerformedSection {
  id: string;
  lines: string[];
}
export interface PerformedOrder {
  sections: PerformedSection[];
  issues: string[];
}
const count = (n: number | null | undefined): number =>
  Number.isInteger(n) && n! >= 1 && n! <= MAX_SECTION_REPEAT ? n! : 1;
const same = (a: string[], b: string[]): boolean => a.join('\0') === b.join('\0');

const ENDING_LABEL = /^(?:final|ending)\s*:\s*/i;
const NOTE_SEQUENCE = /\s*(?:\+|->|→)\s*/;
const CUE_DETAIL = /\s*(?:[-:]\s*|\()([^()]*)\)?$/;
const BARE_CUE_DETAIL = /\s+(f[aă]r[aă] instrumente|solo)$/i;
const VOCAL_DETAIL = /^(?:jos|sus|forte|piano|f[aă]r[aă] instrumente|solo)$/i;
const REPEAT_ALL =
  /^(?:(?:se\s+repet[aă]|repet[aă]m)\s+tot(?:\s+(?:[îi]nc[aă]\s+o\s*dat[aă]|de\s+(\d+)\s+ori))?|repeat\s+all(?:\s+(?:once\s+more|twice|(\d+)\s+times))?)\s*[.!]?$/i;
const MUSICAL_JUMP = /^(?:d\s*\.\s*[cs]\s*\.|(?:da capo|dal segno)\b)/i;
const MAX_GROUP_EXPANSION = 2_000;

interface Cue extends SectionReference {
  atPosition?: boolean;
}

function sourceText(block: Block): string {
  return normalizeRepeatMarks(block.lines.map((line) => line.text).join('\n')).trim();
}

function referenceTargets(
  reference: SectionReference,
  usable: Block[],
  aliases: Map<string, SectionReference>,
): { targets: Block[]; repeat: number | undefined; cycle: boolean } {
  let { target, repeat } = reference;
  const visited = new Set<string>();
  while ('id' in target) {
    const id = target.id;
    if (visited.has(id)) return { targets: [], repeat, cycle: true };
    const alias = aliases.get(id);
    if (!alias)
      return { targets: usable.filter((block) => block.id === id), repeat, cycle: false };
    visited.add(id);
    target = alias.target;
    repeat ??= alias.repeat;
  }
  const type = target.type;
  const matching = usable.filter((block) => block.type === type);
  const targets =
    target.ordinal === undefined
      ? matching
      : matching.slice(target.ordinal - 1, target.ordinal);
  return { targets, repeat, cycle: false };
}

function blockReference(block: Block): SectionReference | null {
  const text = block.lines
    .map((line) => line.text)
    .join('\n')
    .trim();
  if (text.includes('\n')) return null;
  const cue = parseSectionReference(text.replace(ENDING_LABEL, ''));
  return cue && ('id' in cue.target || SUNG.has(cue.target.type)) ? cue : null;
}

/** Strip known display metadata, retaining punctuation and numbers in sung text. */
function cleanLine(raw: string, first: boolean): string {
  let text = raw.trim();
  if (
    /^(?:\[|\()(?:band|solo|instrumental|intro|repeat|repet|piano|guitar|chitar|forte|soft|doar)\b.*(?:\]|\))$/i.test(
      text,
    )
  )
    return '';
  if (/^(?:intro|instrumental|solo|nota|note|doar pentru trup[aă]|band only)\b/i.test(text))
    return '';
  text = text.replace(
    /^(?:(?:Verse|Strofa|Strofă|Chorus|Refrain|Refren|Ref|Cor|Pre[- ]?(?:Chorus|Refren)|Bridge|Punte|Ending|Final|Tag|Coda)\s*\d*|[VCPBET]\d+)\s*[:.]?\s*$/i,
    '',
  );
  text = text.replace(
    /^(?:(?:Verse|Strofa|Strofă|Chorus|Refrain|Refren|Ref|Cor|Pre[- ]?(?:Chorus|Refren)|Bridge|Punte|Ending|Final|Tag|Coda)\s*\d*|[VCPBET]\d+)\s*:\s*/i,
    '',
  );
  if (first) text = text.replace(/^\d+[.)]\s+/, '');
  text = text.replace(/\[[A-G][^\]]*\]/g, '');
  if (text && text.split(/\s+/).every((word) => parseChord(word).kind === 'chords')) return '';
  return text.trim();
}

function lyricLines(block: Block, issues: string[]): { lines: string[]; wholeRepeat: number } {
  const { text, wholeRepeat } = expandLyricRepeats(sourceText(block), block.id, issues);
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (MUSICAL_JUMP.test(line.trim())) {
      issues.push(`${block.id}: review musical jump “${line.trim()}”`);
      continue;
    }
    const lyric = cleanLine(line, lines.length === 0);
    if (lyric) lines.push(lyric);
  }
  return { lines, wholeRepeat };
}

function resolveEnding(
  block: Block,
  earlier: Block[],
  notes: Map<string, Cue[]>,
  issues: string[],
): Block {
  const lyrics = block.lines
    .flatMap((line) => line.text.split('\n').map((row) => row.trim()))
    .filter(Boolean);
  const cues: SectionReference[] = [];
  while (lyrics.length > 1) {
    const cue = parseSectionReference(lyrics.at(-1)!);
    if (!cue || !('type' in cue.target) || cue.target.type !== 'Chorus') break;
    cues.unshift(cue);
    lyrics.pop();
  }
  if (cues.length) notes.set(block.id, cues);

  // A labeled, abbreviated ending can name the start of the final passage of an earlier chorus.
  const line = lyrics[0] ?? '';
  const suffix =
    lyrics.length === 1 && ENDING_LABEL.test(line) && !blockReference(block)
      ? TRAILING_REPEAT.exec(line)
      : null;
  const prefix = suffix ? cleanLine(line.slice(0, suffix.index), true).toLowerCase() : '';
  if (suffix && prefix) {
    const matches: string[][] = [];
    for (const chorus of earlier) {
      if (chorus.type !== 'Chorus' || blockReference(chorus)) continue;
      const rows = lyricLines(chorus, []).lines;
      for (const [index, row] of rows.entries()) {
        const lower = row.toLowerCase();
        if (
          lower.startsWith(prefix) &&
          (!lower[prefix.length] || /[\s,.:;!?…—–-]/u.test(lower[prefix.length]!))
        ) {
          const passage = rows.slice(index);
          if (!matches.some((other) => same(other, passage))) matches.push(passage);
        }
      }
    }
    if (matches.length === 1 && matches[0]![0]!.toLowerCase() !== prefix) {
      const passage = matches[0]!;
      passage[passage.length - 1] += suffix[0];
      return { ...block, lines: passage.map(emptyLine) };
    }
    if (matches.length > 1 && !matches.some(([first]) => first?.toLowerCase() === prefix))
      issues.push(
        `${block.id}: more than one chorus passage matches “${line.slice(0, suffix.index)}”`,
      );
  }
  return cues.length ? { ...block, lines: lyrics.map(emptyLine) } : block;
}

interface RepeatRange {
  ids: string[];
  repeat: number;
}

/** Legacy brackets can surround several complete consecutive source blocks. */
function extractRepeatRanges(blocks: Block[]): RepeatRange[] {
  const ranges: RepeatRange[] = [];
  const texts = blocks.map(sourceText);
  let offset = 0;
  const starts = texts.map((text) => {
    const start = offset;
    offset += text.length + 1;
    return start;
  });
  const blockAt = (position: number) => starts.findLastIndex((start) => start <= position);
  const text = texts.join('\n');
  const pending = [...parseRepeatSpans(text).spans];
  while (pending.length) {
    const span = pending.pop()!;
    pending.push(...span.children);
    const start = blockAt(span.start);
    const end = blockAt(span.bodyEnd);
    if (start === end || end !== blockAt(span.end)) continue;
    const before = text.slice(starts[start], span.start);
    if (before.includes('\n') || cleanLine(before, true)) continue;
    const after = texts[end]!.slice(span.end - starts[end]!);
    if (after.trim()) continue;
    const group = blocks.slice(start, end + 1);
    if (group.some(blockReference)) continue;
    ranges.push({ ids: group.map((block) => block.id), repeat: span.repeat });
    blocks[start] = {
      ...blocks[start]!,
      lines: texts[start]!.slice(span.bodyStart - starts[start]!)
        .split('\n')
        .map(emptyLine),
    };
    blocks[end] = {
      ...blocks[end]!,
      lines: texts[end]!.slice(0, span.bodyEnd - starts[end]!)
        .split('\n')
        .map(emptyLine),
    };
  }
  return ranges;
}

/** Discovery uses the same lyric cleanup as generation, without rejecting ambiguous orders. */
export function firstSungLine(block: Block): string | null {
  if (blockReference(block)) return null;
  return lyricLines(block, []).lines[0] ?? null;
}

interface Occurrence {
  id: string;
  repeat?: number | undefined;
  atPosition?: boolean;
  repeatAll?: number;
}

/** Resolve cues in the order in which the musician sees them in the source. */
function sourceOccurrences(
  blocks: Block[],
  usable: Block[],
  references: Map<string, SectionReference>,
  notes: Map<string, Cue[]>,
  repeatAll: Map<string, number>,
  inferOrder: boolean,
  issues: string[],
): { order: Occurrence[]; aliases: Map<string, Occurrence>; defaults: Map<string, number> } {
  const authored = new Map<string, Occurrence>(usable.map((b) => [b.id, { id: b.id }]));
  const order: Occurrence[] = [];
  const aliases = new Map<string, Occurrence>();
  const defaults = new Map<string, number>();
  for (const [index, block] of blocks.entries()) {
    const all = repeatAll.get(block.id);
    if (inferOrder && all !== undefined) order.push({ id: block.id, repeatAll: all });
    const occurrence = authored.get(block.id);
    if (occurrence) {
      order.push(occurrence);
      if (!inferOrder) continue;
    }
    const alias = references.get(block.id);
    const cues: Cue[] = alias ? [alias] : (notes.get(block.id) ?? []);
    for (const reference of cues) {
      const { targets, repeat, cycle } = referenceTargets(reference, usable, references);
      const recent = order.findLast((one) => targets.some((target) => target.id === one.id));
      const target = targets.find((one) => one.id === recent?.id) ?? targets[0];
      if (!target) {
        if (inferOrder || !alias)
          issues.push(
            cycle
              ? `${block.id}: circular section reference`
              : `${block.id}: repeat has no matching lyric section`,
          );
        continue;
      }
      if (alias) {
        const resolved = { id: target.id, repeat };
        aliases.set(block.id, resolved);
        order.push(resolved);
        continue;
      }
      if (repeat !== undefined && count(repeat) !== repeat) {
        issues.push(`${block.id}: unsupported repeat count ${repeat}`);
        continue;
      }
      const previous = order.at(-1);
      if (reference.atPosition) {
        if (inferOrder) order.push({ id: target.id, repeat, atPosition: true });
        continue;
      }
      if (inferOrder && previous && target.type === 'Chorus') {
        // A cue beside an authored chorus sets that appearance's count. A cue
        // after another section can bring the chorus back at that point.
        const next = blocks.slice(index + 1).find((one) => authored.has(one.id));
        const adjacent =
          previous.id === target.id
            ? previous
            : next && targets.some((one) => one.id === next.id)
              ? authored.get(next.id)
              : undefined;
        if (!adjacent) order.push({ id: target.id, repeat });
        else if (repeat !== undefined) {
          if (adjacent.repeat !== undefined && adjacent.repeat !== repeat)
            issues.push(`Conflicting repeats: ${adjacent.id}`);
          adjacent.repeat = repeat;
        }
      } else if (repeat !== undefined) {
        // Header notes and non-chorus repeat instructions retain their
        // section-wide meaning.
        for (const { id } of targets) {
          const existing = defaults.get(id);
          if (existing !== undefined && existing !== repeat)
            issues.push(`Conflicting repeats: ${id}`);
          defaults.set(id, repeat);
        }
      }
    }
  }
  return { order, aliases, defaults };
}

function parseNoteCues(note: string): Cue[] | null {
  const prefix =
    /^(?:(?:repet[aă]m|repeat|(?:la\s+)?[îi]nceput|opening)\s*:\s*|(?:go\s+to|return\s+to|revenim\s+la)\s+)/i.exec(
      note,
    );
  const parts = note.slice(prefix?.[0].length ?? 0).split(NOTE_SEQUENCE);
  const cues: Cue[] = [];
  for (const part of parts) {
    const plain = parseSectionReference(part);
    if (plain) {
      cues.push({ ...plain, atPosition: parts.length > 1 || prefix !== null });
      continue;
    }
    const detail = BARE_CUE_DETAIL.exec(part) ?? CUE_DETAIL.exec(part);
    const reference = detail && parseSectionReference(part.slice(0, detail.index));
    if (!reference || !detail) return null;
    if (/^instrumental\b/i.test(detail[1]!.trim())) continue;
    if (!VOCAL_DETAIL.test(detail[1]!.trim())) return null;
    cues.push({ ...reference, atPosition: true });
  }
  return cues;
}

export function resolvePerformedOrder(song: Song): PerformedOrder {
  const issues: string[] = [];
  const endingIssues = new Map<string, string[]>();
  const notes = new Map<string, Cue[]>();
  const repeatAll = new Map<string, number>();
  // Some imported direction-only blocks were labeled Verse by the old editor.
  const directionBlocks = new Set(
    song.blocks
      .filter((block) => {
        if (block.lines.length !== 1) return false;
        const line = block.lines[0]!.text.trim();
        if (!NOTE_SEQUENCE.test(line)) return false;
        const opening = line
          .replace(/^(?:repet[aă]m|repeat)\s*:\s*/i, '')
          .split(NOTE_SEQUENCE)[0];
        return !!opening && parseSectionReference(opening) !== null;
      })
      .map((block) => block.id),
  );
  const audience = song.blocks
    .filter(
      (block) => SUNG.has(block.type) && !block.bandOnly && !directionBlocks.has(block.id),
    )
    .map((block, index, blocks) => {
      if (block.type !== 'Ending') return block;
      const blockIssues: string[] = [];
      const ending = resolveEnding(block, blocks.slice(0, index), notes, blockIssues);
      if (blockIssues.length) endingIssues.set(block.id, blockIssues);
      return ending;
    });
  const ranges = extractRepeatRanges(audience);
  const references = new Map<string, SectionReference>();
  for (const block of audience) {
    const reference = blockReference(block);
    if (reference) references.set(block.id, reference);
  }
  const usable = audience.filter((b) => !references.has(b.id));
  const byId = new Map(usable.map((b) => [b.id, b]));
  const structures: string[][] = [];
  let suppress = false;
  const knownIds = new Set(song.blocks.map((block) => block.id));
  for (const block of song.blocks) {
    if (block.type !== 'Note' && !directionBlocks.has(block.id)) continue;
    const directives: Cue[] = [];
    for (const raw of block.lines.flatMap((line) => line.text.split('\n'))) {
      const note = raw.trim();
      const structure = /^(?:STRUCTURA|STRUCTURĂ|ORDER|ARRANGEMENT)\s*:\s*(.+)$/i.exec(note);
      if (structure) {
        const parsed = parseArrangementText(structure[1]!);
        const ids = parsed?.map((id) => {
          if (knownIds.has(id)) return id;
          const candidates = usable.filter((b) => b.id[0] === id[0]);
          return candidates.length === 1 ? candidates[0]!.id : id;
        });
        if (ids && ids.every((id) => knownIds.has(id))) structures.push(ids);
        else issues.push(`Cannot resolve arrangement note: ${note}`);
        continue;
      }
      if (/^(?:fără refren|fara refren|no chorus|omit chorus)$/i.test(note)) {
        suppress = true;
        continue;
      }
      if (/^(?:intro|instrumental|solo)\s*:/i.test(note)) continue;
      const all = REPEAT_ALL.exec(note);
      if (all) {
        const repeat = Number(all[1] ?? all[2] ?? 2);
        if (repeat !== count(repeat) || repeatAll.size)
          issues.push(`Review ambiguous instruction: ${note}`);
        else repeatAll.set(block.id, repeat);
        continue;
      }
      const parsed = parseNoteCues(note);
      if (parsed)
        directives.push(
          ...parsed.filter(
            (cue) =>
              cue.atPosition ||
              cue.repeat !== undefined ||
              ('type' in cue.target && cue.target.type === 'Chorus'),
          ),
        );
      else if (
        MUSICAL_JUMP.test(note) ||
        /\b(?:refren|ref|chorus|repet\w*|repeat|structur\w*|ordine|go to|return to)\b|[x×]\s*\d+\b/i.test(
          note,
        )
      )
        issues.push(`Review ambiguous instruction: ${note}`);
    }
    if (directives.length) notes.set(block.id, directives);
  }
  const reviewed = song.arrangementSource === 'reviewed';
  const inferred =
    song.arrangementSource === 'inferred' ||
    structures.some((s) => same(s, song.arrangement ?? []));
  const sourceOrder = same(
    song.arrangement ?? [],
    song.blocks.map((b) => b.id),
  );
  let ids: string[] | null =
    song.arrangement?.length &&
    (reviewed || (!inferred && !sourceOrder && song.arrangementSource !== 'source'))
      ? [...song.arrangement]
      : null;
  if (reviewed) {
    issues.length = 0;
    notes.clear();
    suppress = false;
  } // Reviewed order supersedes note interpretations.
  if (!ids && structures.length) {
    if (structures.some((s) => !same(s, structures[0]!)) || suppress)
      issues.push('Conflicting arrangement notes');
    else ids = structures[0]!;
  }
  const explicit = ids !== null;
  const source = sourceOccurrences(
    song.blocks,
    usable,
    references,
    notes,
    repeatAll,
    !explicit,
    issues,
  );
  let order: Occurrence[];
  if (ids) {
    order = ids.map((id) => source.aliases.get(id) ?? { id });
  } else {
    order = [];
    const nextWithinRange = new Map<string, string>();
    for (const { ids: group } of ranges)
      for (let index = 1; index < group.length; index++)
        nextWithinRange.set(group[index - 1]!, group[index]!);
    let chorus: Block | undefined = usable.find((b) => b.type === 'Chorus');
    for (let i = 0; i < source.order.length; i++) {
      const current = source.order[i]!;
      if (current.repeatAll !== undefined) {
        order.push(current);
        continue;
      }
      const b = byId.get(current.id)!;
      if (suppress && b.type === 'Chorus') continue;
      if (b.type === 'Chorus') chorus = b;
      order.push(current);
      if (b.type !== 'Verse') continue;
      const nextInRange = nextWithinRange.get(current.id);
      if (nextInRange && nextInRange === source.order[i + 1]?.id) continue;
      // Prechoruses belong with the verse before a chorus is inserted.
      while (byId.get(source.order[i + 1]?.id ?? '')?.type === 'PreChorus')
        order.push(source.order[++i]!);
      const next = source.order[i + 1];
      if (suppress || next?.atPosition || byId.get(next?.id ?? '')?.type === 'Chorus') continue;
      if (chorus) order.push({ id: chorus.id });
    }
  }
  const sections: PerformedSection[] = [];
  function repeatSections(id: string, start: number, times: number): void {
    if (times === 1) return;
    const length = sections.length - start;
    if (sections.length + length * (times - 1) > MAX_GROUP_EXPANSION) {
      issues.push(`${id}: expanded section repeat is too large`);
      return;
    }
    const group = sections.slice(start);
    for (let n = 1; n < times; n++) sections.push(...group);
  }
  const rangeStarts = new Map(ranges.map((range) => [range.ids[0]!, range]));
  const repeatsAtEnd = new Map<number, { id: string; start: number; repeat: number }>();
  for (const [index, { id, repeat, repeatAll }] of order.entries()) {
    if (repeatAll !== undefined) {
      if (!sections.length) issues.push(`${id}: no sung sections before the repeat cue`);
      repeatSections(id, 0, repeatAll);
      continue;
    }
    const range = reviewed ? undefined : rangeStarts.get(id);
    if (range) {
      const matches = (start: number): boolean =>
        range.ids.every((sectionId, offset) => order[start + offset]?.id === sectionId);
      if (!matches(index))
        issues.push(`${id}: repeat spans sections that are separated in this order`);
      else {
        if (range.repeat !== count(range.repeat))
          issues.push(`${id}: unsupported repeat count ${range.repeat}`);
        const end = index + range.ids.length;
        if (!(explicit && (matches(end) || matches(index - range.ids.length))))
          repeatsAtEnd.set(end - 1, {
            id,
            start: sections.length,
            repeat: count(range.repeat),
          });
      }
    }
    const b = byId.get(id);
    if (!b) {
      const alias = references.get(id);
      if (alias)
        issues.push(
          referenceTargets(alias, usable, references).cycle
            ? `${id}: circular section reference`
            : `${id}: repeat has no matching lyric section`,
        );
      else if (!knownIds.has(id)) issues.push(`Unknown arrangement section: ${id}`);
      continue;
    }
    issues.push(...(endingIssues.get(id) ?? []));
    if (b.repeat !== null && count(b.repeat) !== b.repeat)
      issues.push(`${id}: unsupported block repeat count ${b.repeat}`);
    if (repeat !== undefined && count(repeat) !== repeat)
      issues.push(`${id}: unsupported repeat count ${repeat}`);
    const lyric = lyricLines(b, issues);
    const sourceId = ids?.[index] ?? id;
    const represented =
      reviewed ||
      (ids !== null && (ids[index - 1] === sourceId || ids[index + 1] === sourceId));
    // Legacy paste/import paths sometimes expanded the same complete block while
    // retaining its repeat metadata. Recognise only exact, whole-block copies.
    let runStart = index;
    let runEnd = index + 1;
    if (ids && represented) {
      while (ids[runStart - 1] === sourceId) runStart--;
      while (ids[runEnd] === sourceId) runEnd++;
    }
    const defaultRepeat = source.defaults.get(id);
    const encodedCount = Math.max(
      count(b.repeat),
      count(repeat ?? defaultRepeat),
      represented ? runEnd - runStart : 1,
    );
    if (
      lyric.wholeRepeat === 1 &&
      encodedCount > 1 &&
      lyric.lines.length % encodedCount === 0
    ) {
      const unit = lyric.lines.slice(0, lyric.lines.length / encodedCount);
      if (same(lyric.lines, Array<string[]>(encodedCount).fill(unit).flat()))
        lyric.lines = unit;
    }

    const counts = [
      b.repeat,
      lyric.wholeRepeat > 1 ? lyric.wholeRepeat : null,
      defaultRepeat,
    ].filter((n): n is number => n != null && n > 1);
    if (!represented && repeat === undefined && new Set(counts).size > 1)
      issues.push(`${id}: conflicting repeat counts`);
    const repeats = represented
      ? 1
      : repeat !== undefined
        ? count(repeat)
        : Math.max(count(b.repeat), lyric.wholeRepeat, count(defaultRepeat));
    if (lyric.lines.length)
      for (let n = 0; n < repeats; n++) sections.push({ id, lines: [...lyric.lines] });
    const group = repeatsAtEnd.get(index);
    if (group) repeatSections(group.id, group.start, group.repeat);
  }
  return { sections, issues: [...new Set(issues)] };
}
