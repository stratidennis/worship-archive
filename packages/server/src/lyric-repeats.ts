import { MAX_SECTION_REPEAT, multiplierValue, REPEAT_MULTIPLIER } from '@worship/core';

const REPEAT_MARKER = /\/:|:\/|(?<!\d)%/;
export const TRAILING_REPEAT = new RegExp(
  `(?:[ \\t]+|(?=\\())(${REPEAT_MULTIPLIER})[ \\t]*$`,
  'i',
);
const COUNT_AFTER_MARK = new RegExp(`^[ \\t]*(${REPEAT_MULTIPLIER})(?![\\p{L}\\p{N}.])`, 'iu');
const COUNT_ON_NEXT_ROW = new RegExp(
  `^[ \\t]*\\r?\\n[ \\t]*(${REPEAT_MULTIPLIER})[ \\t]*(?=\\r?\\n|$)`,
  'i',
);
const MAX_REPEAT_DEPTH = 32;
const MAX_EXPANDED_CHARS = 128_000;
const LAST_COUNT_ROW = new RegExp(`\\r?\\n[ \\t]*(${REPEAT_MULTIPLIER})[ \\t]*$`, 'i');

interface RepeatFrame {
  marker: string;
  start: number;
  bodyStart: number;
  children: RepeatSpan[];
}

interface RepeatSpan extends RepeatFrame {
  bodyEnd: number;
  end: number;
  repeat: number;
}

export function normalizeRepeatMarks(text: string): string {
  return text
    .replace(/\|\|:|𝄆/gu, '/:')
    .replace(/:\|\||𝄇/gu, ':/')
    .replace(
      new RegExp(
        `:[ \\t]*[/\\\\](?=[ \\t]*(?:${REPEAT_MULTIPLIER})?[ \\t]*(?:\\r?\\n|$))`,
        'gi',
      ),
      ':/',
    );
}

/** A stack is needed because a repeat can contain another repeat with its own count. */
function scanRepeatSpans(
  text: string,
  legacyClose: boolean,
): {
  spans: RepeatSpan[];
  unmatched: number;
} {
  const spans: RepeatSpan[] = [];
  const stack: RepeatFrame[] = [];
  let unmatched = 0;
  let consumed = 0;
  for (const match of text.matchAll(new RegExp(REPEAT_MARKER.source, 'g'))) {
    const start = match.index;
    if (start < consumed) continue;
    const marker = match[0];
    const top = stack.at(-1);
    const after = text.slice(start + marker.length);
    const multiplier = COUNT_AFTER_MARK.exec(after) ?? COUNT_ON_NEXT_ROW.exec(after);
    const rest = after.slice(multiplier?.[0].length ?? 0);
    const backwards =
      legacyClose &&
      marker === '/:' &&
      top?.marker === '/:' &&
      /^[ \t]*(?:\r?\n|$)/.test(rest) &&
      text.slice(Math.max(top.bodyStart, text.lastIndexOf('\n', start - 1) + 1), start).trim();
    const closing = marker === ':/' || (marker === '%' && top?.marker === '%') || backwards;
    if (!closing) {
      if (stack.length === MAX_REPEAT_DEPTH) return { spans: [], unmatched: unmatched + 1 };
      stack.push({ marker, start, bodyStart: start + marker.length, children: [] });
      continue;
    }
    if (!top || (marker === ':/' && top.marker !== '/:')) {
      unmatched++;
      continue;
    }
    stack.pop();
    consumed = start + marker.length + (multiplier?.[0].length ?? 0);
    (stack.at(-1)?.children ?? spans).push({
      ...top,
      bodyEnd: start,
      end: consumed,
      repeat: multiplier ? multiplierValue(multiplier[1]!) : 2,
    });
  }
  // Closed inner spans remain usable in a draft even when their outer span is damaged.
  for (const frame of stack) spans.push(...frame.children);
  return { spans, unmatched: unmatched + stack.length };
}

export function parseRepeatSpans(text: string): { spans: RepeatSpan[]; unmatched: number } {
  const parsed = scanRepeatSpans(text, false);
  if (!parsed.unmatched) return parsed;
  const legacy = scanRepeatSpans(text, true);
  return legacy.unmatched < parsed.unmatched ? legacy : parsed;
}

export function expandLyricRepeats(
  original: string,
  blockId: string,
  issues: string[],
): { text: string; wholeRepeat: number } {
  let text = original;
  let wholeRepeat = 1;
  const suffix = LAST_COUNT_ROW.exec(text) ?? TRAILING_REPEAT.exec(text);
  if (suffix) {
    const lyrics = text.slice(0, suffix.index);
    const start = REPEAT_MARKER.test(lyrics) ? lyrics.lastIndexOf('\n') + 1 : 0;
    const body = lyrics.slice(start);
    if (body.trim() && !REPEAT_MARKER.test(body))
      text = lyrics.slice(0, start) + '/:' + body + ':/ ' + suffix[1];
  }

  const parsed = parseRepeatSpans(text);

  function render(
    start: number,
    end: number,
    spans: RepeatSpan[],
    whole: boolean,
  ): string | null {
    let output = '';
    let cursor = start;
    for (const [index, span] of spans.entries()) {
      const before = text.slice(cursor, span.start);
      const rawBody = text.slice(span.bodyStart, span.bodyEnd).trim();
      const nested = render(span.bodyStart, span.bodyEnd, span.children, false);
      if (nested === null) return null;
      const body = nested.trim();
      if (!body) issues.push(`${blockId}: empty lyric repeat`);
      const validCount =
        Number.isInteger(span.repeat) && span.repeat >= 1 && span.repeat <= MAX_SECTION_REPEAT;
      if (!validCount) issues.push(`${blockId}: unsupported repeat count ${span.repeat}`);
      const times = validCount ? span.repeat : 1;
      let remaining = text.slice(span.end, spans[index + 1]?.start ?? end).trimStart();
      let expanded = 0;
      while (rawBody && remaining.startsWith(rawBody)) {
        const tail = remaining.slice(rawBody.length);
        if (!/^[ \t]*(?:\r?\n|$)/.test(tail)) break;
        expanded++;
        remaining = tail.trimStart();
      }
      if (whole && spans.length === 1 && !before.trim() && !remaining.trim()) {
        wholeRepeat = Math.max(times, expanded + 1);
        return body.length * wholeRepeat <= MAX_EXPANDED_CHARS ? body : null;
      }
      const copies = Math.max(1, times - expanded);
      if (output.length + before.length + (body.length + 1) * copies > MAX_EXPANDED_CHARS)
        return null;
      output += before + Array<string>(copies).fill(body).join('\n');
      cursor = span.end;
    }
    return output + text.slice(cursor, end);
  }

  const rendered = render(0, text.length, parsed.spans, true);
  if (rendered === null) {
    issues.push(`${blockId}: expanded lyric repeat is too large`);
    wholeRepeat = 1;
  }
  text = rendered ?? original;
  const unresolved = new RegExp(
    `${REPEAT_MARKER.source}|(?:^[ \\t]*|[ \\t]+|(?=\\())${REPEAT_MULTIPLIER}[ \\t]*$`,
    'gim',
  );
  if (parsed.unmatched || unresolved.test(text))
    issues.push(`${blockId}: unmatched or unsupported lyric repeat; review the source`);

  // Unresolved syntax stays out of a draft, while the sung words remain editable.
  if (rendered === null) {
    const closeWithCount = new RegExp(`(?:[:]/|%)[ \\t]*${REPEAT_MULTIPLIER}`, 'gi');
    text = text.replace(closeWithCount, '');
  }
  return { text: text.replace(unresolved, ''), wholeRepeat };
}
