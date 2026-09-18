import { semitonesBetween, type ServiceSet, type Song } from '@worship/core';
import type { Translator } from '../lib/i18n.js';
import { setName } from '../lib/setName.js';
import { SongBody } from './SongBody.js';

/**
 * The set as it prints: the running order, then every song in it.
 *
 * It used to be the running order alone, which is the one page you do not need on
 * paper — the running order is on the screen in front of you. What you print a set for
 * is the other thing: a folder for the guitarist whose tablet died, a copy for a
 * visiting musician, the version that still works when the WiFi does not. That means
 * the songs themselves, in the key and capo this service uses them in, not the key they
 * happen to be filed under.
 *
 * So: page one is the order, and each song starts a new page after it. Notes and gaps
 * are not given pages of their own — they flow after whatever they follow, which is
 * where they belong, since a note is nearly always an instruction about the song just
 * above it.
 *
 * A separate view rather than the editor with its controls hidden: printed inputs
 * render as empty boxes, and a set handed to the band should read as a set, not as a
 * form someone forgot to fill in. This is also the PDF export — the browser's own
 * "Save as PDF" is the whole feature, with nothing to install.
 */
export function PrintableSet({
  set,
  songs,
  t,
  formatDate,
}: {
  set: ServiceSet;
  songs: Record<string, Song>;
  t: Translator['t'];
  formatDate: Translator['date'];
}) {
  const date = set.date
    ? formatDate(set.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="hidden print:block print:text-[11pt]">
      <h1 className="mb-0.5 text-xl font-bold">{setName(set, formatDate)}</h1>
      {date && <p className="mb-4 text-sm">{date}</p>}

      {/*
        Every item is numbered, songs and notes and gaps alike, and by its position in
        the service rather than among its own kind. Songs used to be numbered
        separately, which left the other rows blank — a list reading 1, _, 3, _ looks
        like something failed to load. It also means this sheet and the screen agree on
        what "number four" is, which they would not if one counted songs and the other
        counted everything.
      */}
      <ol className="space-y-1">
        {set.items.map((item, index) => {
          if (item.kind === 'song') {
            const song = songs[item.songId];
            const key = item.keyOverride ?? song?.performanceKey ?? song?.writtenKey ?? null;
            return (
              <li key={index} className="flex items-baseline gap-2 break-inside-avoid">
                <span className="w-5 shrink-0 text-right tabular-nums">{index + 1}.</span>
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
              <li key={index} className="flex items-baseline gap-2 break-inside-avoid text-sm">
                <span className="w-5 shrink-0 text-right tabular-nums">{index + 1}.</span>
                {/* Same fallback as the sidebar: a bare number with nothing beside it
                    reads as a printing fault rather than an empty note. */}
                <span className="italic">{item.text || t('sets.note')}</span>
              </li>
            );
          }
          return (
            <li key={index} className="flex items-baseline gap-2 break-inside-avoid text-sm">
              <span className="w-5 shrink-0 text-right tabular-nums">{index + 1}.</span>
              <span>
                {item.label || t('sets.gap')}
                {item.minutes ? ` — ${item.minutes} ${t('sets.minutes')}` : ''}
              </span>
            </li>
          );
        })}
      </ol>

      {set.items.map((item, index) => {
        if (item.kind === 'song') {
          const song = songs[item.songId];
          if (!song) return null;
          const native = song.performanceKey ?? song.writtenKey ?? null;
          // The key this service plays it in, not the key it is filed under.
          const shift =
            item.keyOverride && native ? (semitonesBetween(native, item.keyOverride) ?? 0) : 0;
          const key = item.keyOverride ?? native;
          return (
            <section key={index} className="break-before-page pt-2">
              <h2 className="text-lg font-bold">
                {index + 1}. {song.title}
              </h2>
              <p className="mb-2 text-sm">
                {[
                  key ?? '',
                  item.capoOverride ? `${t('sets.capo')} ${item.capoOverride}` : '',
                  song.tempo ? `${song.tempo} bpm` : '',
                  song.timeSignature ?? '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <SongBody
                song={song}
                options={{
                  showChords: true,
                  showBass: false,
                  capo: item.capoOverride ?? 0,
                  transpose: shift,
                }}
              />
            </section>
          );
        }
        if (item.kind === 'note') {
          return (
            <section key={index} className="mt-4 break-inside-avoid">
              <p className="text-sm italic">
                {index + 1}. {item.text || t('sets.note')}
              </p>
            </section>
          );
        }
        return (
          <section key={index} className="mt-4 break-inside-avoid">
            <p className="text-sm">
              {index + 1}. {item.label || t('sets.gap')}
              {item.minutes ? ` — ${item.minutes} ${t('sets.minutes')}` : ''}
            </p>
          </section>
        );
      })}
    </div>
  );
}
