import type { LanguageName, ThemeName } from '@worship/core';
import { useT } from '../lib/i18n.js';
import { IconCheck } from './icons.js';
import { Segment, Segmented } from './ui.js';

/**
 * How words look on a screen — in one place, because three screens now ask.
 *
 * The settings page asks for this device. The band view asks for the phone in
 * somebody's hand, which has no room for a page of settings and no navigation to reach
 * one. And the settings page asks *again* on behalf of the stage displays, which have
 * nobody standing at them at all.
 *
 * Three callers, the same four questions, so the controls are values-in,
 * changes-out and know nothing about where the answer is stored. That is the only
 * reason the stage's copy can write to the session while the other two write to
 * localStorage without any of them being a special case.
 *
 * `null` is a real answer everywhere here, and it means "whatever that screen would do
 * on its own". Only the stage offers it: for this device, "auto" and "the theme accent"
 * already say the same thing.
 */

export const CHORD_COLOURS: { value: string; label: string }[] = [
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#ec4899', label: 'Magenta' },
  { value: '#10b981', label: 'Green' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#8b5cf6', label: 'Violet' },
];

export function LanguageChoice<T extends LanguageName | null>({
  value,
  onChange,
  inherit,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  /** Offer "as the screen has it" as a first option. */
  inherit?: string;
  /** Omitted where the surrounding heading already says it. */
  label?: string | undefined;
}) {
  const { t } = useT();
  return (
    <Field label={label}>
      {/* Wraps rather than clips: with an extra "as the screen" segment in front,
          these strips are one option wider than the settings column is. */}
      <Segmented label={t('settings.language')} className="max-w-full flex-wrap">
        {inherit && (
          <Segment active={value === null} onClick={() => onChange(null as T)}>
            {inherit}
          </Segment>
        )}
        {(
          [
            ['ro', 'Română'],
            ['en', 'English'],
          ] as const
        ).map(([code, label]) => (
          <Segment key={code} active={value === code} onClick={() => onChange(code as T)}>
            {label}
          </Segment>
        ))}
      </Segmented>
    </Field>
  );
}

export function ThemeChoice<T extends ThemeName | null>({
  value,
  onChange,
  inherit,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  inherit?: string;
  label?: string | undefined;
}) {
  const { t } = useT();
  return (
    <Field label={label}>
      <Segmented label={t('settings.theme')} className="max-w-full flex-wrap">
        {inherit && (
          <Segment active={value === null} onClick={() => onChange(null as T)}>
            {inherit}
          </Segment>
        )}
        {(
          [
            ['auto', t('settings.themeAuto')],
            ['light', t('settings.themeLight')],
            ['dark', t('settings.themeDark')],
            ['stage', t('settings.themeStage')],
          ] as const
        ).map(([name, label]) => (
          <Segment key={name} active={value === name} onClick={() => onChange(name as T)}>
            {label}
          </Segment>
        ))}
      </Segmented>
    </Field>
  );
}

export function FontSize({
  value,
  onChange,
  onClear,
  clearLabel,
  fallback,
}: {
  value: number | null;
  onChange: (value: number) => void;
  /**
   * Give the size back to whoever owned it before.
   *
   * A slider cannot express "unset" by itself — every position is a number — so the
   * three other controls could be handed back and this one could not, and a text size
   * chosen once for one screen could never be undone.
   */
  onClear?: (() => void) | undefined;
  clearLabel?: string | undefined;
  /** Shown when nothing has been chosen — the size that screen would use anyway. */
  fallback?: number;
}) {
  const { t } = useT();
  const shown = value ?? fallback ?? 26;
  return (
    <label className="mt-4 block">
      <span className="flex items-baseline justify-between gap-2 text-sm">
        {t('settings.maxFont')}
        <span className="flex items-baseline gap-2">
          {onClear && clearLabel && value !== null && (
            <button
              type="button"
              onClick={onClear}
              className="rounded text-xs text-(--color-chord) hover:underline"
            >
              {clearLabel}
            </button>
          )}
          <span className="font-mono text-xs text-(--color-muted)">{shown}px</span>
        </span>
      </span>
      <input
        type="range"
        min={14}
        max={72}
        step={1}
        value={shown}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full cursor-pointer accent-(--color-chord)"
      />
      <span className="mt-1 block text-xs text-(--color-muted)">
        {t('settings.maxFontHint')}
      </span>
    </label>
  );
}

/**
 * What colour the chords are.
 *
 * Six presets and a picker, rather than a picker alone: most of the reason anyone opens
 * this is "I cannot see the chords in this room", and the answer is usually one of the
 * loud ones — the amber and the red are there to be found in two seconds on a bright
 * stage. The picker is for the person who wants their own.
 *
 * The preview is the control's whole justification. A swatch tells you what the colour
 * is; two lines of a song tell you whether you can read it, which is the actual
 * question.
 */
export function ChordColour({
  value,
  onChange,
  defaultLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  defaultLabel?: string;
}) {
  const { t } = useT();
  const custom = value !== null && !CHORD_COLOURS.some((c) => c.value === value);

  return (
    <div className="mt-4">
      <span className="block text-sm">{t('settings.chordColor')}</span>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Swatch
          selected={value === null}
          label={defaultLabel ?? t('settings.chordColorDefault')}
          colour="var(--color-chord)"
          onClick={() => onChange(null)}
        />
        {CHORD_COLOURS.map((colour) => (
          <Swatch
            key={colour.value}
            selected={value === colour.value}
            label={colour.label}
            colour={colour.value}
            onClick={() => onChange(colour.value)}
          />
        ))}

        <label
          title={t('settings.chordColorCustom')}
          className={`relative grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 transition ${
            custom ? 'border-(--color-chord)' : 'border-transparent hover:border-(--color-line)'
          }`}
        >
          <span
            className="h-6 w-6 rounded-full border border-(--color-line)"
            style={{
              background: custom
                ? value
                : 'conic-gradient(#ef4444,#f59e0b,#10b981,#06b6d4,#8b5cf6,#ec4899,#ef4444)',
            }}
          />
          <input
            type="color"
            aria-label={t('settings.chordColorCustom')}
            value={value ?? '#3b82f6'}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/** A live sample, in whatever colour is currently chosen for *this* page. */
export function ChordSample({ colour }: { colour?: string | null }) {
  const { t } = useT();
  return (
    <div className="mt-3 rounded-lg border border-(--color-line) bg-(--color-raised) px-3 py-2 font-mono text-sm leading-tight">
      <span
        className="block whitespace-pre text-[0.72em] font-semibold"
        style={{ color: colour ?? 'var(--color-chord-ink)' }}
      >
        {t('settings.chordColorSampleChords')}
      </span>
      <span className="block">{t('settings.chordColorSample')}</span>
    </div>
  );
}

function Field({ label, children }: { label?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      {label && <span className="mb-1.5 block text-sm">{label}</span>}
      {children}
    </div>
  );
}

function Swatch({
  selected,
  label,
  colour,
  onClick,
}: {
  selected: boolean;
  label: string;
  colour: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-full border-2 transition ${
        selected ? 'border-(--color-chord)' : 'border-transparent hover:border-(--color-line)'
      }`}
    >
      <span
        className="grid h-6 w-6 place-items-center rounded-full border border-(--color-line)"
        style={{ background: colour }}
      >
        {selected && <IconCheck size={13} className="text-white" />}
      </span>
    </button>
  );
}
