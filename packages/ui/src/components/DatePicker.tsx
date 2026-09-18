import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { enGB, ro } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { useT } from '../lib/i18n.js';
import { IconCalendar } from './icons.js';

/**
 * Choosing the date of a service.
 *
 * A native `<input type="date">` was what this replaced. It drew its own calendar
 * button — a second one beside ours — in whatever style the browser felt like, which
 * on a dark background was very nearly invisible and never matched anything else here.
 *
 * `react-day-picker` draws the grid; the appearance is entirely ours, themed from the
 * same `--color-*` tokens as the songs (see `index.css`). It is bundled like everything
 * else, so it works with no network.
 */
export function DatePicker({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
}) {
  const { lang, date: format } = useT();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // A date-only value must not go through UTC: `new Date('2026-09-20')` is midnight UTC,
  // which in a negative offset is the 19th. Constructing from parts keeps it local.
  const selected = value ? fromIso(value) : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-(--color-line) bg-(--color-surface) px-3 text-sm font-semibold transition-colors hover:bg-(--color-line)"
      >
        <IconCalendar size={16} className="shrink-0 text-(--color-muted)" />
        {value ? format(value) : label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-1 rounded-xl border border-(--color-line) bg-(--color-surface) p-2 shadow-xl"
        >
          <DayPicker
            mode="single"
            required={false}
            selected={selected}
            {...(selected ? { defaultMonth: selected } : {})}
            onSelect={(picked) => {
              onChange(picked ? toIso(picked) : null);
              setOpen(false);
            }}
            locale={lang === 'ro' ? ro : enGB}
            weekStartsOn={1}
            showOutsideDays
          />
        </div>
      )}
    </div>
  );
}

function fromIso(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIso(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
