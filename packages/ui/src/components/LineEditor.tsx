import { useEffect, useMemo, useRef, useState } from 'react';
import type { Line } from '@worship/core';
import { useT } from '../lib/i18n.js';

/**
 * One editable lyric line, with its chords stacked above the right syllables.
 *
 * The alignment trick: the chord row is built from the same segmentation as the lyric,
 * with each segment's text rendered invisibly as a spacer. Both layers therefore use
 * identical text metrics, so a chord always sits exactly over the character it is
 * anchored to — no measuring, and nothing to drift when the font or zoom changes.
 */

export interface LineEditorProps {
  line: Line;
  layer: 'chords' | 'bass';
  showChords: boolean;
  onTextChange: (text: string) => void;
  onChordChange: (at: number, raw: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  /** Multi-line paste: the text arrives already split on its own line breaks. */
  onPasteLines: (at: number, text: string) => void;
  autoFocus?: boolean;
}

interface Segment {
  at: number;
  chord: string | null;
  text: string;
}

function segmentsOf(line: Line, layer: 'chords' | 'bass', editingAt: number | null): Segment[] {
  const anchors = [...line[layer]];
  // A new chord has no stored anchor yet. Insert a temporary empty one so the editor
  // has a segment to attach its input to at the position the user just clicked.
  if (editingAt !== null && !anchors.some((anchor) => anchor.at === editingAt)) {
    anchors.push({ at: editingAt, raw: '' });
  }
  anchors.sort((a, b) => a.at - b.at);
  const out: Segment[] = [];

  if (anchors.length === 0 || (anchors[0]?.at ?? 0) > 0) {
    out.push({
      at: 0,
      chord: null,
      text: line.text.slice(0, anchors[0]?.at ?? line.text.length),
    });
  }
  anchors.forEach((anchor, i) => {
    const next = anchors[i + 1]?.at ?? line.text.length;
    out.push({
      at: anchor.at,
      chord: anchor.raw,
      text: line.text.slice(Math.min(anchor.at, line.text.length), next),
    });
  });
  return out;
}

export function LineEditor({
  line,
  layer,
  showChords,
  onTextChange,
  onChordChange,
  onEnter,
  onBackspaceEmpty,
  onPasteLines,
  autoFocus,
}: LineEditorProps) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [editingAt, setEditingAt] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const segments = useMemo(() => segmentsOf(line, layer, editingAt), [line, layer, editingAt]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const startChordAt = (at: number): void => {
    setEditingAt(at);
    setDraft(line[layer].find((a) => a.at === at)?.raw ?? '');
  };

  /**
   * Turn a click above the lyric into the nearest character boundary.
   *
   * Measuring the actual input font matters here: dividing by an average character
   * width puts a chord over the wrong syllable as soon as a line contains both narrow
   * letters such as `i` and wide ones such as `m`.
   */
  const startChordAtPointer = (clientX: number): void => {
    const lyric = input.current;
    if (!lyric) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    const style = window.getComputedStyle(lyric);
    context.font = style.font;
    const x = Math.max(0, clientX - lyric.getBoundingClientRect().left + lyric.scrollLeft);
    let at = line.text.length;
    for (let index = 0; index <= line.text.length; index++) {
      const here = context.measureText(line.text.slice(0, index)).width;
      const next = context.measureText(line.text.slice(0, index + 1)).width;
      if (x <= (here + next) / 2) {
        at = index;
        break;
      }
    }
    lyric.setSelectionRange(at, at);
    startChordAt(at);
  };

  const commitChord = (): void => {
    if (editingAt !== null) onChordChange(editingAt, draft);
    setEditingAt(null);
    setDraft('');
    input.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // F9 places a chord at the caret — the same key the old SongEditor used, so the
    // muscle memory carries over.
    if (event.key === 'F9') {
      event.preventDefault();
      startChordAt(input.current?.selectionStart ?? 0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
      return;
    }
    if (event.key === 'Backspace' && line.text === '' && line[layer].length === 0) {
      event.preventDefault();
      onBackspaceEmpty();
    }
  };

  return (
    <div className="group relative">
      {showChords && (
        <div
          className="relative flex h-[1.15em] w-full cursor-text items-end text-[0.72em] font-semibold leading-[1.1]"
          title={t('edit.addChord')}
          onClick={(event) => startChordAtPointer(event.clientX)}
        >
          {segments.map((segment, i) => (
            <span key={i} className="relative whitespace-pre">
              {/* Invisible spacer: identical metrics to the lyric below. */}
              <span className="invisible">{segment.text || ' '}</span>
              {editingAt === segment.at ? (
                <input
                  autoFocus
                  value={draft}
                  // Select on focus: editing a chord almost always means replacing it,
                  // not appending to it. Without this, clicking "G" and typing "Am"
                  // silently produces "GAm".
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitChord}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      commitChord();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingAt(null);
                      input.current?.focus();
                    }
                  }}
                  className="absolute left-0 top-0 z-10 w-16 rounded border border-(--color-chord) bg-(--color-stage-bg) px-1 text-[1em] font-semibold text-(--color-chord-ink) outline-none"
                  placeholder={t('edit.chordPlaceholder')}
                  aria-label={t('edit.chordPlaceholder')}
                />
              ) : segment.chord ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    startChordAt(segment.at);
                  }}
                  className="absolute left-0 top-0 cursor-pointer rounded px-0.5 font-semibold text-(--color-chord-ink) hover:bg-(--color-chord)/15"
                  title={t('edit.editChord')}
                  aria-label={t('edit.editChord')}
                >
                  {segment.chord}
                </button>
              ) : null}
            </span>
          ))}
          {line[layer].length === 0 && editingAt === null && (
            <span className="pointer-events-none absolute left-0 top-0 text-[0.82em] font-normal text-(--color-muted) opacity-0 transition-opacity group-focus-within:opacity-45 group-hover:opacity-45">
              {t('edit.addChord')}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1">
        <input
          ref={input}
          value={line.text}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text/plain');
            // Single-line text is left to the browser, which handles selection
            // replacement and the undo stack better than this could.
            if (!pasted.includes('\n') && !pasted.includes('\r')) return;
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart ?? target.value.length;
            const end = target.selectionEnd ?? start;
            // A selection is replaced, as paste always does: drop it first, then insert.
            const withoutSelection =
              start === end ? line.text : line.text.slice(0, start) + line.text.slice(end);
            if (withoutSelection !== line.text) onTextChange(withoutSelection);
            onPasteLines(start, pasted);
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="w-full bg-transparent leading-[1.25] outline-none focus:bg-(--color-chord)/5"
          placeholder="…"
        />
      </div>
    </div>
  );
}
