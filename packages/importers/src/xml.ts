/**
 * A tiny scanner for the legacy `.song` format.
 *
 * A general XML parser is the wrong tool here: chord anchors are mixed content
 * (`Eu Te iu<chord>G</chord>besc`) and we need the exact character offset of each chord
 * in the de-tagged lyric text. A DOM would have to be walked to recover that anyway.
 *
 * The format is small and entirely known — all 153 files were surveyed — so a targeted
 * scanner is both simpler and more precise.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode XML entities, including numeric ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body] ?? match;
  });
}

/** Read the text content of the first `<tag>…</tag>`, or null. */
export function tagText(source: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(source);
  return m ? decodeEntities(m[1]!) : null;
}

export interface Element {
  /** Raw attribute string, e.g. ` type="Verse" id="V1"`. */
  attrs: Record<string, string>;
  /** Inner markup, not decoded. */
  inner: string;
}

/** Find every `<tag …>…</tag>` at any depth, in document order. */
export function findElements(source: string, tag: string): Element[] {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
  const out: Element[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ attrs: parseAttrs(m[1] ?? ''), inner: m[2] ?? '' });
  }
  return out;
}

export function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[2]!);
  }
  return out;
}
