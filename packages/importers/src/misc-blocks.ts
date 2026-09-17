/**
 * Classifying the legacy "Misc" blocks.
 *
 * 303 of the 1045 blocks in the real library are type `Misc` — the second most common
 * type. They are not miscellaneous at all: they are performance directions that the
 * old data model had nowhere to put, so they were typed as free text 303 times.
 *
 * This module turns the confident cases into structured data and leaves everything
 * else alone. The guiding rule: **a wrong guess is worse than no guess.** A misread
 * arrangement changes what the band plays on Sunday, so anything ambiguous stays a
 * Note block and appears in the migration report for a human to look at.
 */

import type { BlockType, Singers } from '@worship/core';

export interface MiscClassification {
  /** What the block should become. */
  type: BlockType;
  /** Label for the block, e.g. the person named in `SOLO Dennis:`. */
  label: string | null;
  /** Text to keep as the block's content. Empty means the block carried no content. */
  lines: string[];
  /** `TOTI:` and similar mean "everyone sings" — applied to the following block. */
  singersHint: Singers | null;
  /** A written→performance key change recovered from `TRANSPOSE:` / `GAMA:`. */
  keyChange: { written: string; performance: string; semitones: number } | null;
  /** An arrangement recovered from a `STRUCTURA:` line, for review. */
  arrangementHint: string[] | null;
  /** True when the block carried only a directive and should be dropped entirely. */
  redundant: boolean;
  /** Why it was classified this way — shown in the migration report. */
  reason: string;
}

/** `TRANSPOSE: G+3=>Bb`, `GAMA: D+1 => Eb`. */
const KEY_CHANGE_RE =
  /\b(?:TRANSPOSE|GAMA|GAMMA)\s*:?\s*([A-Ga-g][#b]?m?)\s*([+-]\s*\d+)?\s*=*>\s*([A-Ga-g][#b]?m?)/i;

/** `STRUCTURA: Strofa -> Refren x2 -> Final` */
const STRUCTURE_RE = /\b(?:STRUCTURA|STRUCTURĂ)\s*:?\s*(.+)$/i;

/** Romanian section words → block types, for reading arrangement text. */
const SECTION_WORDS: Record<string, string> = {
  strofa: 'V',
  strofă: 'V',
  vers: 'V',
  verse: 'V',
  refren: 'C',
  ref: 'C',
  chorus: 'C',
  bridge: 'B',
  punte: 'B',
  final: 'E',
  ending: 'E',
  incheiere: 'E',
  intro: 'I',
  intrare: 'I',
  instrumental: 'N',
  solo: 'S',
  prechorus: 'P',
};

interface Rule {
  test: RegExp;
  type: BlockType;
  reason: string;
  /** Extracts a label from the first matching line. */
  label?: (m: RegExpExecArray, line: string) => string | null;
}

const RULES: Rule[] = [
  {
    // `SOLO Dennis:` / `SOLO: Dennis` / `SOLO`
    test: /^\s*SOLO\b\s*:?\s*(.*?)\s*:?\s*$/i,
    type: 'Solo',
    reason: 'solo cue',
    label: (m) => {
      const name = (m[1] ?? '').trim().replace(/[:.]+$/, '');
      return name.length > 0 && name.length < 40 ? name : null;
    },
  },
  {
    test: /^\s*(?:INTRO|INTRARE)\b/i,
    type: 'Intro',
    reason: 'intro cue',
  },
  {
    test: /^\s*(?:INSTRUMENTAL|INSTR)\b/i,
    type: 'Instrumental',
    reason: 'instrumental break',
  },
  {
    test: /^\s*(?:FINAL|INCHEIERE|ÎNCHEIERE)\b/i,
    type: 'Ending',
    reason: 'ending cue',
  },
];

/** `TOTI`, `TOTI:`, `TOŢI` — "everyone". */
const ALL_SINGERS_RE = /^\s*(?:TOTI|TOȚI|TOŢI|ALL|EVERYONE)\s*:?\s*$/i;

/**
 * Read `Strofa -> Refren x2 -> Final` into block ids.
 *
 * Returns null unless every element is recognised — a partially understood arrangement
 * is worse than none, because it would silently drop a section.
 */
export function parseArrangementText(text: string): string[] | null {
  const parts = text
    .split(/->|→|>|,|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const out: string[] = [];
  const seen = new Map<string, number>();

  for (const part of parts) {
    // "Refren x2", "Strofa 1", "Refren"
    const m = /^([A-Za-zĂÂÎȘȚăâîșț]+)\s*(\d+)?\s*(?:x\s*(\d+))?$/i.exec(part);
    if (!m) return null;
    const prefix = SECTION_WORDS[m[1]!.toLowerCase()];
    if (!prefix) return null;

    const explicit = m[2] ? Number(m[2]) : null;
    const times = m[3] ? Number(m[3]) : 1;
    if (!Number.isFinite(times) || times < 1 || times > 20) return null;

    const n = explicit ?? (seen.get(prefix) ?? 0) + 1;
    if (explicit === null) seen.set(prefix, n);

    for (let i = 0; i < times; i++) out.push(`${prefix}${n}`);
  }
  return out.length > 0 ? out : null;
}

function semitonesFromSign(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Classify one legacy Misc block.
 *
 * `lines` is the block's text content, in order.
 */
export function classifyMisc(lines: string[]): MiscClassification {
  const kept = lines.filter((l) => l.trim() !== '');
  const first = kept[0] ?? '';

  // A key change is a fact, not a cue — it belongs in the song's fields. Whatever else
  // the block said is then classified on its own, so `TRANSPOSE: …` followed by
  // `INTRO chitara: …` still yields an Intro rather than collapsing to a Note.
  for (const line of kept) {
    const m = KEY_CHANGE_RE.exec(line);
    if (m) {
      const rest = kept.filter((l) => l !== line);
      const remainder = rest.length > 0 ? classifyMisc(rest) : null;
      return {
        type: remainder?.type ?? 'Note',
        label: remainder?.label ?? null,
        lines: remainder?.lines ?? [],
        singersHint: remainder?.singersHint ?? null,
        keyChange: {
          written: m[1]!,
          performance: m[3]!,
          semitones: semitonesFromSign(m[2]),
        },
        arrangementHint: remainder?.arrangementHint ?? null,
        redundant: remainder === null || remainder.redundant,
        reason: remainder
          ? `key change extracted; remainder ${remainder.reason}`
          : 'key change extracted to written/performance key',
      };
    }
  }

  // An explicit structure line.
  for (const line of kept) {
    const m = STRUCTURE_RE.exec(line);
    if (m) {
      const hint = parseArrangementText(m[1]!);
      return {
        type: 'Note',
        label: null,
        lines: kept,
        singersHint: null,
        keyChange: null,
        arrangementHint: hint,
        redundant: false,
        reason: hint
          ? 'structure line read as a suggested arrangement (kept as a note for review)'
          : 'structure line kept verbatim — not confidently parseable',
      };
    }
  }

  if (kept.length > 0 && kept.every((l) => ALL_SINGERS_RE.test(l))) {
    return {
      type: 'Note',
      label: null,
      lines: [],
      singersHint: 'All',
      keyChange: null,
      arrangementHint: null,
      redundant: true,
      reason: '"everyone sings" marker applied to the following block',
    };
  }

  for (const rule of RULES) {
    const m = rule.test.exec(first);
    if (m) {
      return {
        type: rule.type,
        label: rule.label ? rule.label(m, first) : null,
        lines: kept,
        singersHint: null,
        keyChange: null,
        arrangementHint: null,
        redundant: false,
        reason: rule.reason,
      };
    }
  }

  return {
    type: 'Note',
    label: null,
    lines: kept,
    singersHint: null,
    keyChange: null,
    arrangementHint: null,
    redundant: kept.length === 0,
    reason: 'kept as a note',
  };
}
