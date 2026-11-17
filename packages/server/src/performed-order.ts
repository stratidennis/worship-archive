/** Presentation-only interpretation. Never edits the source song or its notes. */
import { parseChord, type Block, type Song } from '@worship/core';
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
  let text = raw.join('\n');
  let wholeRepeat = 1;
  const spans = /\/:([\s\S]*?):\/\s*(?:[x×]\s*(\d+))?|%([^%]*?)%\s*(?:[x×]\s*(\d+))?/gi;
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
      expanded++;
      remaining = remaining.slice(body.length).trimStart();
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

export function resolvePerformedOrder(song: Song): PerformedOrder {
  const issues: string[] = [];
  const usable = song.blocks.filter((b) => SUNG.has(b.type) && !b.bandOnly);
  const byId = new Map(usable.map((b) => [b.id, b]));
  const notes = song.blocks
    .filter((b) => b.type === 'Note')
    .flatMap((b) => b.lines.map((l) => l.text.trim()));
  const structures: string[][] = [];
  const noteRepeats = new Map<string, number>();
  let suppress = false;
  for (const note of notes) {
    const structure = /^(?:STRUCTURA|STRUCTURĂ|ORDER|ARRANGEMENT)\s*:\s*(.+)$/i.exec(note);
    if (structure) {
      const parsed = parseArrangementText(structure[1]!);
      const ids = parsed?.map((id) => {
        if (song.blocks.some((b) => b.id === id)) return id;
        const candidates = usable.filter((b) => b.id[0] === id[0]);
        return candidates.length === 1 ? candidates[0]!.id : id;
      });
      if (ids && ids.every((id) => song.blocks.some((b) => b.id === id))) structures.push(ids);
      else issues.push(`Cannot resolve arrangement note: ${note}`);
      continue;
    }
    if (/^(?:fără refren|fara refren|no chorus|omit chorus)$/i.test(note)) {
      suppress = true;
      continue;
    }
    const repeat =
      /^(V\d+|C\d+|B\d+|E\d+|P\d+|T\d+|refren|chorus|bridge|punte|final|ending|strofa|verse)\s*[x×]\s*(\d+)$/i.exec(
        note,
      );
    if (repeat) {
      const types: Record<string, string> = {
        refren: 'Chorus',
        chorus: 'Chorus',
        bridge: 'Bridge',
        punte: 'Bridge',
        final: 'Ending',
        ending: 'Ending',
        strofa: 'Verse',
        verse: 'Verse',
      };
      const targets = usable.filter(
        (b) => b.id === repeat[1]!.toUpperCase() || b.type === types[repeat[1]!.toLowerCase()],
      );
      if (!targets.length) issues.push(`Unknown repeat target: ${note}`);
      for (const b of targets) {
        const authoredCount = Number(repeat[2]);
        if (count(authoredCount) !== authoredCount)
          issues.push(`Unsupported repeat count: ${note}`);
        const n = count(authoredCount);
        if (noteRepeats.has(b.id) && noteRepeats.get(b.id) !== n)
          issues.push(`Conflicting repeats: ${b.id}`);
        noteRepeats.set(b.id, n);
      }
    } else if (/\b(?:refren|chorus|repet|repeat|structur|ordine)\b|\bx\d+\b/i.test(note))
      issues.push(`Review ambiguous instruction: ${note}`);
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
    noteRepeats.clear();
    suppress = false;
  } // Reviewed order supersedes note interpretations.
  if (!ids && structures.length) {
    if (structures.some((s) => !same(s, structures[0]!)) || suppress)
      issues.push('Conflicting arrangement notes');
    else ids = structures[0]!;
  }
  const explicit = ids !== null;
  if (!ids) {
    ids = [];
    let chorus: Block | undefined = usable.find((b) => b.type === 'Chorus');
    for (let i = 0; i < usable.length; i++) {
      const b = usable[i]!;
      if (suppress && b.type === 'Chorus') continue;
      if (b.type === 'Chorus') chorus = b;
      ids.push(b.id);
      if (b.type !== 'Verse') continue;
      // Prechoruses belong with the verse before a chorus is inserted.
      while (usable[i + 1]?.type === 'PreChorus') ids.push(usable[++i]!.id);
      if (suppress || usable[i + 1]?.type === 'Chorus') continue;
      if (chorus) ids.push(chorus.id);
    }
  }
  const sections: PerformedSection[] = [];
  for (const [index, id] of ids.entries()) {
    const b = byId.get(id);
    if (!b) {
      if (!song.blocks.some((block) => block.id === id))
        issues.push(`Unknown arrangement section: ${id}`);
      continue;
    }
    if (b.repeat !== null && count(b.repeat) !== b.repeat)
      issues.push(`${id}: unsupported block repeat count ${b.repeat}`);
    const lyric = lyricLines(b, issues);
    const represented =
      reviewed || (explicit && (ids[index - 1] === id || ids[index + 1] === id));
    // Legacy paste/import paths sometimes expanded the same complete block while
    // retaining its repeat metadata. Recognise only exact, whole-block copies.
    let runStart = index;
    let runEnd = index + 1;
    while (ids[runStart - 1] === id) runStart--;
    while (ids[runEnd] === id) runEnd++;
    const encodedCount = Math.max(
      count(b.repeat),
      noteRepeats.get(id) ?? 1,
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
      noteRepeats.get(id),
    ].filter((n): n is number => n != null && n > 1);
    if (!represented && new Set(counts).size > 1)
      issues.push(`${id}: conflicting repeat counts`);
    const repeats = represented
      ? 1
      : Math.max(count(b.repeat), lyric.wholeRepeat, noteRepeats.get(id) ?? 1);
    if (lyric.lines.length)
      for (let n = 0; n < repeats; n++) sections.push({ id, lines: [...lyric.lines] });
  }
  return { sections, issues: [...new Set(issues)] };
}
