import type { ServiceSet, Song } from '@worship/core';
import type { Translator } from '../lib/i18n.js';

/**
 * The running order as it prints.
 *
 * A separate view rather than the editor with its controls hidden: printed inputs
 * render as empty boxes, and a set list handed to the band should read as a list, not
 * as a form someone forgot to fill in. This is also the PDF export — the browser's own
 * "Save as PDF" is the whole feature, with nothing to install.
 */
export function PrintableRunningOrder({
  set,
  songs,
  songNumbers,
  t,
  formatDate,
}: {
  set: ServiceSet;
  songs: Record<string, Song>;
  songNumbers: Map<number, number>;
  t: Translator['t'];
  formatDate: Translator['date'];
}) {
  const date = set.date
    ? formatDate(set.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="hidden print:block">
      <h1 className="mb-0.5 text-xl font-bold">{set.title}</h1>
      {date && <p className="mb-4 text-sm">{date}</p>}

      <ol className="space-y-1">
        {set.items.map((item, index) => {
          if (item.kind === 'song') {
            const song = songs[item.songId];
            const key = item.keyOverride ?? song?.performanceKey ?? song?.writtenKey ?? null;
            return (
              <li key={index} className="flex items-baseline gap-2 break-inside-avoid">
                <span className="w-5 shrink-0 text-right tabular-nums">
                  {songNumbers.get(index)}.
                </span>
                <span className="font-medium">{song?.title ?? t('sets.missingSong')}</span>
                <span className="flex-1 border-b border-dotted border-black/30" />
                <span className="shrink-0 font-mono text-sm">
                  {key ?? '—'}
                  {item.capoOverride ? ` · ${t('sets.capo')} ${item.capoOverride}` : ''}
                  {song?.tempo ? ` · ${song.tempo}` : ''}
                </span>
              </li>
            );
          }
          if (item.kind === 'note') {
            return (
              <li key={index} className="break-inside-avoid pl-7 text-sm italic">
                {item.text}
              </li>
            );
          }
          return (
            <li key={index} className="break-inside-avoid pl-7 text-sm">
              {item.label || t('sets.gap')}
              {item.minutes ? ` — ${item.minutes} ${t('sets.minutes')}` : ''}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
