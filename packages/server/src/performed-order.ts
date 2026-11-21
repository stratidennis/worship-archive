/** Presentation-only interpretation. Never edits the source song or its notes. */
import { parseChord, type Block, type BlockType, type Song } from '@worship/core';
import { parseArrangementText } from '@worship/importers';

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
  Number.isInteger(n) && n! >= 1 && n! <= 20 ? n! : 1;
const same = (a: string[], b: string[]): boolean => a.join('\0') === b.join('\0');

const SECTION_NAMES = new Map<string, BlockType>([
  ['refren', 'Chorus'],
  ['chorus', 'Chorus'],
  ['punte', 'Bridge'],
  ['bridge', 'Bridge'],
  ['final', 'Ending'],
  ['ending', 'Ending'],
  ['strofa', 'Verse'],
  ['strofă', 'Verse'],
  ['verse', 'Verse'],
]);

interface SectionReference {
  target: { id: string } | { type: BlockType; ordinal: number | undefined };
  repeat: number | undefined;
}

function parseSectionReference(text: string): SectionReference | null {
  const prefix = /^(?:(\d+)\s*[x×]|[x×]\s*(\d+))\s+(?:refren|chorus)$/i.exec(text);
  if (prefix) {
    return {
      target: { type: 'Chorus', ordinal: undefined },
      repeat: Number(prefix[1] ?? prefix[2]),
    };
  }
  const match = /^([a-ză]+)\s*(\d+)?\s*(?:[x×]\s*(\d+))?$/i.exec(text);
  if (!match) return null;

  const name = match[1]!;
  const type = SECTION_NAMES.get(name.toLowerCase());
  const ordinal = match[2] === undefined ? undefined : Number(match[2]);
  const repeat = match[3];
  const target = type
    ? { type, ordinal }
    : ordinal !== undefined && /^[VCPBET]$/i.test(name)
      ? { id: name.toUpperCase() + match[2] }
      : null;
  return target ? { target, repeat: repeat === undefined ? undefined : Number(repeat) } : null;
}

function referenceTargets(reference: SectionReference, usable: Block[]): Block[] {
  const { target } = reference;
  if ('id' in target) return usable.filter((block) => block.id === target.id);
  const matching = usable.filter((block) => block.type === target.type);
  return target.ordinal === undefined
    ? matching
    : matching.slice(Math.max(0, target.ordinal - 1), target.ordinal);
}

function blockReference(block: Block): SectionReference | null {
  const text = block.lines
    .map((line) => line.text)
    .join('\n')
    .trim();
  if (text.includes('\n')) return null;
  return parseSectionReference(text.replace(/^(?:final|ending)\s*:\s*/i, ''));
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
    /^(?:(?:Verse|Strofa|Strofă|Chorus|Refren|Pre[- ]?Chorus|Bridge|Punte|Ending|Final|Tag)\s*\d*|[VCPBET]\d+)\s*[:.]?\s*$/i,
    '',
  );
  text = text.replace(
    /^(?:(?:Verse|Strofa|Strofă|Chorus|Refren|Pre[- ]?Chorus|Bridge|Punte|Ending|Final|Tag)\s*\d*|[VCPBET]\d+)\s*:\s*/i,
    '',
  );
  if (first) text = text.replace(/^\d+[.)]\s+/, '');
  text = text.replace(/\[[A-G][^\]]*\]/g, '');
  if (text && text.split(/\s+/).every((word) => parseChord(word).kind === 'chords')) return '';
  return text.trim();
}

/** Repository repeat syntax: /: ... :/ [xN], or % ... % [xN]. */
function lyricLines(block: Block, issues: string[]): { lines: string[]; wholeRepeat: number } {
  const raw = block.lines.flatMap((line) => line.text.split('\n'));
  // Some legacy songs close a repeat with /: at the end of a lyric row.
  // Require an earlier opener and lyrics on the row that ends with the marker.
  let text = raw
    .join('\n')
    .replace(
      /(\/:(?:(?!\/:|:\/)[\s\S])*?[^\s/:][ \t]*)\/:(?=[ \t]*(?:[x×][ \t]*\d+)?[ \t]*(?:\n|$))/gi,
      '$1:/',
    );
  let wholeRepeat = 1;
  const spans = /\/:([\s\S]*?):\/(?:\s*[x×]\s*(\d+))?|%([^%]*?)%(?:\s*[x×]\s*(\d+))?/gi;
  const matches = [...text.matchAll(spans)];
  for (const match of matches.reverse()) {
    const body = (match[1] ?? match[3] ?? '').trim();
    const authoredCount = Number(match[2] ?? match[4] ?? 2);
    if (count(authoredCount) !== authoredCount)
      issues.push(`${block.id}: unsupported repeat count ${authoredCount}`);
    const times = count(authoredCount);
    const before = text.slice(0, match.index);
    const after = text.slice(match.index! + match[0].length);
    let remaining = after.trimStart();
    let expanded = 0;
    while (body && remaining.startsWith(body)) {
      const tail = remaining.slice(body.length);
      if (!/^[ \t]*(?:\r?\n|$)/.test(tail)) break;
      expanded++;
      remaining = tail.trimStart();
    }
    if (!before.trim() && !remaining.trim()) {
      wholeRepeat = Math.max(times, expanded + 1);
      text = body;
    } else {
      text =
        before +
        Array(Math.max(1, times - expanded))
          .fill(body)
          .join('\n') +
        after;
    }
  }
  if (/(?:\/:|:\/|%|[x×]\s*\d+\s*$)/im.test(text)) {
    issues.push(`${block.id}: unmatched or unsupported lyric repeat; review the source`);
  }
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const lyric = cleanLine(line, lines.length === 0);
    if (lyric) lines.push(lyric);
  }
  return { lines, wholeRepeat };
}

/** Discovery uses the same lyric cleanup as generation, without rejecting ambiguous orders. */
export function firstSungLine(block: Block): string | null {
  if (blockReference(block)) return null;
  return lyricLines(block, []).lines[0] ?? null;
}

interface Occurrence {
  id: string;
  repeat?: number | undefined;
}

/** Resolve cues in the order in which the musician sees them in the source. */
function sourceOccurrences(
  blocks: Block[],
  usable: Block[],
  references: Map<string, SectionReference>,
  notes: Map<string, SectionReference[]>,
  inferOrder: boolean,
  issues: string[],
): { order: Occurrence[]; aliases: Map<string, Occurrence>; defaults: Map<string, number> } {
  const authored = new Map<string, Occurrence>(usable.map((b) => [b.id, { id: b.id }]));
  const order: Occurrence[] = [];
  const aliases = new Map<string, Occurrence>();
  const defaults = new Map<string, number>();
  for (const [index, block] of blocks.entries()) {
    const occurrence = authored.get(block.id);
    if (occurrence) {
      order.push(occurrence);
      continue;
    }
    const alias = references.get(block.id);
    for (const reference of alias ? [alias] : (notes.get(block.id) ?? [])) {
      const targets = referenceTargets(reference, usable);
      const recent = order.findLast((one) => targets.some((target) => target.id === one.id));
      const target = targets.find((one) => one.id === recent?.id) ?? targets[0];
      if (!target) {
        if (inferOrder || !alias)
          issues.push(`${block.id}: repeat has no matching lyric section`);
        continue;
      }
      const repeat = reference.repeat;
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

export function resolvePerformedOrder(song: Song): PerformedOrder {
  const issues: string[] = [];
  const audience = song.blocks.filter((b) => SUNG.has(b.type) && !b.bandOnly);
  const references = new Map<string, SectionReference>();
  for (const block of audience) {
    const reference = blockReference(block);
    if (reference) references.set(block.id, reference);
  }
  const usable = audience.filter((b) => !references.has(b.id));
  const byId = new Map(usable.map((b) => [b.id, b]));
  const structures: string[][] = [];
  const notes = new Map<string, SectionReference[]>();
  let suppress = false;
  const knownIds = new Set(song.blocks.map((block) => block.id));
  for (const block of song.blocks) {
    if (block.type !== 'Note') continue;
    const directives: SectionReference[] = [];
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
      const reference = parseSectionReference(note);
      if (
        reference &&
        (reference.repeat !== undefined ||
          ('type' in reference.target && reference.target.type === 'Chorus'))
      )
        directives.push(reference);
      else if (/\b(?:refren|chorus|repet|repeat|structur|ordine)\b|\bx\d+\b/i.test(note))
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
  const source = sourceOccurrences(song.blocks, usable, references, notes, !explicit, issues);
  let order: Occurrence[];
  if (ids) {
    order = ids.map((id) => source.aliases.get(id) ?? { id });
  } else {
    order = [];
    let chorus: Block | undefined = usable.find((b) => b.type === 'Chorus');
    for (let i = 0; i < source.order.length; i++) {
      const current = source.order[i]!;
      const b = byId.get(current.id)!;
      if (suppress && b.type === 'Chorus') continue;
      if (b.type === 'Chorus') chorus = b;
      order.push(current);
      if (b.type !== 'Verse') continue;
      // Prechoruses belong with the verse before a chorus is inserted.
      while (byId.get(source.order[i + 1]?.id ?? '')?.type === 'PreChorus')
        order.push(source.order[++i]!);
      if (suppress || byId.get(source.order[i + 1]?.id ?? '')?.type === 'Chorus') continue;
      if (chorus) order.push({ id: chorus.id });
    }
  }
  const sections: PerformedSection[] = [];
  for (const [index, { id, repeat }] of order.entries()) {
    const b = byId.get(id);
    if (!b) {
      if (references.has(id)) issues.push(`${id}: repeat has no matching lyric section`);
      else if (!knownIds.has(id)) issues.push(`Unknown arrangement section: ${id}`);
      continue;
    }
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
  }
  return { sections, issues: [...new Set(issues)] };
}
