import {
  DEFAULT_SONG_LINE_HEIGHT,
  ENHARMONIC_PAIRS,
  MAX_FITTED_SONG_FONT_SIZE,
  MAX_SONG_FONT_SIZE,
  MAX_SONG_LINE_HEIGHT,
  MIN_SONG_FONT_SIZE,
  MIN_SONG_LINE_HEIGHT,
  type AccidentalPreferences,
  type CueStyle,
  type LanguageName,
  type ThemeName,
} from '@worship/core';
import { useT } from '../lib/i18n.js';
import { Segment, Segmented } from './ui.js';

/**
 * How words look on a screen — in one place, because three screens now ask.
 *
 * The settings page asks for this device. The band view asks for the phone in
 * somebody's hand, which has no room for a page of settings and no navigation to reach
 * one. And the settings page asks *again* on behalf of the stage displays, which have
 * nobody standing at them at all.
 *
 * Three callers, the same display questions, so the controls are values-in,
 * changes-out and know nothing about where the answer is stored. That is the only
 * reason the stage's copy can write to the session while the other two write to
 * localStorage without any of them being a special case.
 *
 * `null` is a real answer everywhere here, and it means "whatever that screen would do
 * on its own". Only the stage offers it: for this device, "auto" and "the theme accent"
 * already say the same thing.
 */

export function AccidentalChoice({
  value,
  onChange,
}: {
  value: AccidentalPreferences;
  onChange: (value: AccidentalPreferences) => void;
}) {
  const { t } = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {ENHARMONIC_PAIRS.map((pair) => (
        <Field key={pair.pitch} label={`${pair.sharp} / ${pair.flat}`} className="mt-0">
          <Segmented label={`${pair.sharp} / ${pair.flat}`} className="w-full">
            <Segment
              className="flex-1"
              active={value[pair.pitch] === 'sharp'}
              onClick={() => onChange({ ...value, [pair.pitch]: 'sharp' })}
            >
              {pair.sharp}
            </Segment>
            <Segment
              className="flex-1"
              active={value[pair.pitch] === 'flat'}
              onClick={() => onChange({ ...value, [pair.pitch]: 'flat' })}
            >
              {pair.flat}
            </Segment>
          </Segmented>
        </Field>
      ))}
      <p className="text-xs text-(--color-muted) sm:col-span-2 xl:col-span-5">
        {t('settings.accidentalsHint')}
      </p>
    </div>
  );
}

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

export function MinimumFontSize({
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
        {t('settings.minFont')}
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
        min={MIN_SONG_FONT_SIZE}
        max={MAX_SONG_FONT_SIZE}
        step={1}
        value={shown}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full cursor-pointer accent-(--color-chord)"
      />
      <span className="mt-1 block text-xs text-(--color-muted)">
        {t('settings.minFontHint')}
      </span>
    </label>
  );
}

export function MaximumFontSize({
  value,
  onChange,
  onClear,
  clearLabel,
  fallback,
  minimum = MIN_SONG_FONT_SIZE,
}: {
  value: number | null;
  onChange: (value: number) => void;
  onClear?: (() => void) | undefined;
  clearLabel?: string | undefined;
  fallback?: number;
  /** Keep the ceiling from crossing the currently selected floor. */
  minimum?: number;
}) {
  const { t } = useT();
  const shown = Math.max(minimum, value ?? fallback ?? MAX_FITTED_SONG_FONT_SIZE);
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
        min={minimum}
        max={MAX_FITTED_SONG_FONT_SIZE}
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

/** Three deliberate levels of visual density for section labels and cue blocks. */
export function CueStyleChoice<T extends CueStyle | null>({
  value,
  onChange,
  inherit,
}: {
  value: T;
  onChange: (value: T) => void;
  inherit?: string;
}) {
  const { t } = useT();
  const shown = value ?? 'full';
  return (
    <Field label={t('settings.cueStyle')}>
      <Segmented label={t('settings.cueStyle')} className="max-w-full flex-wrap">
        {inherit && (
          <Segment active={value === null} onClick={() => onChange(null as T)}>
            {inherit}
          </Segment>
        )}
        {(['full', 'compact', 'minimal'] as const).map((style) => (
          <Segment key={style} active={value === style} onClick={() => onChange(style as T)}>
            {t(`settings.cueStyle.${style}`)}
          </Segment>
        ))}
      </Segmented>
      <span className="mt-1.5 block text-xs text-(--color-muted)">
        {t(`settings.cueStyle.${shown}Hint`)}
      </span>
    </Field>
  );
}

export function LineSpacing({
  value,
  onChange,
  onClear,
  clearLabel,
  fallback,
}: {
  value: number | null;
  onChange: (value: number) => void;
  onClear?: (() => void) | undefined;
  clearLabel?: string | undefined;
  fallback?: number;
}) {
  const { t } = useT();
  const shown = value ?? fallback ?? DEFAULT_SONG_LINE_HEIGHT;
  return (
    <label className="mt-4 block">
      <span className="flex items-baseline justify-between gap-2 text-sm">
        {t('settings.lineSpacing')}
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
          <span className="font-mono text-xs text-(--color-muted)">{shown.toFixed(2)}×</span>
        </span>
      </span>
      <input
        type="range"
        min={MIN_SONG_LINE_HEIGHT}
        max={MAX_SONG_LINE_HEIGHT}
        step={0.05}
        value={shown}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full cursor-pointer accent-(--color-chord)"
      />
      <span className="mt-1 block text-xs text-(--color-muted)">
        {t('settings.lineSpacingHint')}
      </span>
    </label>
  );
}

function Field({
  label,
  children,
  className = 'mt-4 first:mt-0',
}: {
  label?: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <span className="mb-1.5 block text-sm">{label}</span>}
      {children}
    </div>
  );
}
