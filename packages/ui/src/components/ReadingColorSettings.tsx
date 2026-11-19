import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  BLOCK_TYPES,
  READING_SECTION_COLORS,
  READING_TEXT_COLORS,
  SINGERS,
  emptyBlock,
  emptyLine,
  isReadingColor,
  isReadingSectionColor,
  parseChordPro,
  type BlockType,
  type CueStyle,
  type ReadingColorKey,
  type ReadingColors,
} from '@worship/core';
import { usePrefs } from '../lib/settings.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { confirmAction } from '../lib/confirm.js';
import { cueAppearance } from '../lib/cueAppearance.js';
import {
  readingColorStyle,
  sectionAccentInk,
  SETUP_ACCENT,
  SETUP_BACKGROUND,
} from '../lib/readingColors.js';
import { PerformanceInfo } from './PerformanceInfo.js';
import { SongBody } from './SongBody.js';
import { Button, Input, Select } from './ui.js';

const PRESETS = [
  ['#f59e0b', 'amber'],
  ['#ef4444', 'red'],
  ['#ec4899', 'pink'],
  ['#16a34a', 'green'],
  ['#0891b2', 'cyan'],
  ['#8b5cf6', 'violet'],
] as const;
const SAMPLE_SONG = parseChordPro('{title: Color preview}');
const TEXT_LABELS: Record<(typeof READING_TEXT_COLORS)[number], TranslationKey> = {
  chords: 'song.chords',
  bass: 'settings.colors.bass',
  lyrics: 'settings.colors.lyrics',
  titles: 'settings.colors.titles',
  repeats: 'edit.repeats',
  infoDetails: 'settings.colors.infoDetails',
};

type ColorChange = (key: ReadingColorKey, color: string | null | undefined) => void;
const COLOR_SAVE_DELAY_MS = 1000;

export function DeviceReadingColorSettings() {
  const [prefs, setPrefs] = usePrefs();
  return (
    <ReadingColorSettings
      colors={prefs.readingColors}
      theme={prefs.theme}
      cueStyle={prefs.cueStyle}
      onChange={(key, value) => {
        const readingColors = { ...prefs.readingColors };
        if (value === undefined) delete readingColors[key];
        else readingColors[key] = value;
        setPrefs({
          readingColors,
          ...(key === 'chords' ? { chordColor: value ?? null } : {}),
        });
      }}
      onReset={() => setPrefs({ readingColors: {}, chordColor: null })}
    />
  );
}

export function ReadingColorSettings({
  colors,
  inherited,
  inheritLabel,
  theme,
  cueStyle,
  onChange,
  onReset,
}: {
  colors: ReadingColors;
  inherited?: ReadingColors;
  inheritLabel?: string;
  theme?: 'auto' | 'dark' | 'light';
  cueStyle: CueStyle;
  onChange: ColorChange;
  onReset: () => void;
}) {
  const { t, blockName, singerName } = useT();
  const id = useId();
  const [key, setKey] = useState<ReadingColorKey>('chords');
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<{ key: ReadingColorKey; color: string; timer: number } | null>(null);
  const save = useRef(onChange);
  useLayoutEffect(() => {
    save.current = onChange;
  }, [onChange]);

  const cancelPending = useCallback(() => {
    const queued = pending.current;
    pending.current = null;
    if (queued) window.clearTimeout(queued.timer);
    return queued;
  }, []);

  const savePending = useCallback(() => {
    const queued = cancelPending();
    if (queued) save.current(queued.key, queued.color);
  }, [cancelPending]);

  // Save the pending choice if the user closes settings or switches screens.
  useLayoutEffect(() => savePending, [savePending]);

  const editColor = (value: string): void => {
    cancelPending();
    const color = value.toLowerCase();
    if (isReadingColor(color) && color === colors[key]?.toLowerCase()) {
      setDraft(null);
      return;
    }
    setDraft(value);
    if (!isReadingColor(color)) return;
    const timer = window.setTimeout(() => {
      savePending();
      setDraft(null);
    }, COLOR_SAVE_DELAY_MS);
    pending.current = { key, color, timer };
  };

  const changeColor = (value: string | null | undefined): void => {
    cancelPending();
    setDraft(null);
    if (value !== colors[key]) onChange(key, value);
  };

  const effective = { ...inherited, ...colors };
  const reset = async (): Promise<void> => {
    if (
      !(await confirmAction({
        message: t('settings.colors.resetPrompt'),
        detail: t('settings.colors.resetDetail'),
        confirmLabel: t('settings.colors.resetConfirm'),
      }))
    )
      return;
    cancelPending();
    setDraft(null);
    onReset();
  };
  return (
    <section aria-labelledby={id} className="mt-5 border-t border-(--color-line) pt-4">
      <h3 id={id} className="text-base font-semibold">
        {t('settings.colors.title')}
      </h3>
      <label className="mt-3 grid max-w-xl gap-1.5 text-sm">
        <span>{t('settings.colors.edit')}</span>
        <Select
          value={key}
          onChange={(event) => {
            savePending();
            setDraft(null);
            setKey(event.target.value as ReadingColorKey);
          }}
        >
          <optgroup label={t('settings.colors.textAndMusic')}>
            {READING_TEXT_COLORS.map((item) => (
              <option key={item} value={item}>
                {t(TEXT_LABELS[item])}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('settings.colors.sections')}>
            {READING_SECTION_COLORS.map((item) => (
              <option key={item} value={item}>
                {item === 'background'
                  ? t('settings.colors.background')
                  : item === 'info'
                    ? t('performance.title')
                    : blockName(item)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('settings.colors.singers')}>
            {SINGERS.map((item) => (
              <option key={item} value={item}>
                {singerName(item)}
              </option>
            ))}
          </optgroup>
        </Select>
      </label>
      <ColorEditor
        key={key}
        colorKey={key}
        colors={effective}
        override={colors[key]}
        draft={draft}
        inheritLabel={inheritLabel}
        theme={theme}
        cueStyle={cueStyle}
        onEdit={editColor}
        onChange={changeColor}
      />
      <Button className="mt-3" size="sm" onClick={() => void reset()}>
        {t('settings.colors.reset')}
      </Button>
    </section>
  );
}

function ColorEditor({
  colorKey,
  colors,
  override,
  draft,
  inheritLabel,
  theme,
  cueStyle,
  onEdit,
  onChange,
}: {
  colorKey: ReadingColorKey;
  colors: ReadingColors;
  override: string | null | undefined;
  draft: string | null;
  inheritLabel: string | undefined;
  theme: 'auto' | 'light' | 'dark' | undefined;
  cueStyle: CueStyle;
  onEdit: (value: string) => void;
  onChange: (color: string | null | undefined) => void;
}) {
  const { t } = useT();
  const hexId = useId();
  const [defaultHex, setDefaultHex] = useState('#000000');
  const swatch = useRef<HTMLSpanElement>(null);
  const saved = colors[colorKey];
  const themeColor = defaultColor(colorKey, cueStyle);
  const transparentDefault = themeColor === 'transparent';
  const transparent = saved === 'transparent' || (saved == null && transparentDefault);
  const pickerColor = isReadingColor(saved) ? saved : defaultHex;
  const hex = draft ?? (transparent ? '' : pickerColor);
  const valid = isReadingColor(hex);
  const draftColors = valid && draft !== null ? { ...colors, [colorKey]: hex } : colors;

  // A native color input takes sRGB hex. Sample the actual theme color, including
  // CSS colors such as oklch, so it opens at the color currently shown.
  useLayoutEffect(() => {
    if (!swatch.current) return;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(swatch.current).color;
    ctx.fillRect(0, 0, 1, 1);
    const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    setDefaultHex('#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join(''));
  }, [themeColor, theme]);

  const isDefault = draft === null && (inheritLabel ? override === null : override == null);
  return (
    <div className="mt-3 grid max-w-xl gap-3">
      <div
        data-reading-theme={theme === 'auto' ? undefined : theme}
        className="reading-surface min-w-0 overflow-hidden rounded-lg border border-(--color-line) px-3 py-3"
        style={
          {
            ...readingColorStyle(draftColors),
            '--color-chord-ink': 'var(--color-chord)',
          } as React.CSSProperties
        }
      >
        <ReadingColorPreview colorKey={colorKey} cueStyle={cueStyle} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <input
          type="color"
          aria-label={t('settings.colors.pick')}
          value={valid ? hex : pickerColor}
          onChange={(event) => onEdit(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-(--color-line) bg-(--color-surface) p-1"
        />
        <label className="grid gap-1 text-xs" htmlFor={hexId}>
          {t('settings.colors.hex')}
          <Input
            id={hexId}
            value={hex}
            aria-invalid={(draft !== null && !valid) || undefined}
            placeholder={transparent ? '#RRGGBB' : undefined}
            spellCheck={false}
            maxLength={7}
            onChange={(event) => onEdit(event.target.value)}
            className="w-28 font-mono"
          />
        </label>
        <span
          role="status"
          className="self-end rounded-md px-1 py-2 text-xs text-(--color-muted)"
        >
          {draft !== null && t(valid ? 'settings.colors.saving' : 'settings.colors.invalidHex')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={isDefault}
          className="flex h-9 items-center gap-1.5 rounded-full border border-(--color-line) px-2 text-xs hover:border-(--color-muted) aria-pressed:border-(--color-chord)"
          onClick={() => onChange(inheritLabel ? null : undefined)}
        >
          <span
            ref={swatch}
            aria-hidden="true"
            data-reading-theme={theme === 'auto' ? undefined : theme}
            className={`size-5 rounded-full border ${
              transparentDefault
                ? 'border-dashed border-(--color-muted)'
                : 'border-black/15 bg-current'
            }`}
            style={{ color: transparentDefault ? 'var(--color-stage-bg)' : themeColor }}
          />
          {t('settings.colors.themeDefault')}
        </button>
        {isReadingSectionColor(colorKey) && (
          <button
            type="button"
            aria-pressed={draft === null && override === 'transparent'}
            className="flex h-9 items-center gap-1.5 rounded-full border border-(--color-line) px-2 text-xs hover:border-(--color-muted) aria-pressed:border-(--color-chord)"
            onClick={() => onChange('transparent')}
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-full border border-dashed border-(--color-muted)"
            />
            {t(
              cueStyle === 'minimal' && colorKey !== 'background'
                ? 'settings.colors.noSectionColor'
                : 'settings.colors.noBackground',
            )}
          </button>
        )}
        {PRESETS.map(([color, label]) => (
          <button
            key={color}
            type="button"
            title={t(`settings.colors.preset.${label}`)}
            aria-label={t(`settings.colors.preset.${label}`)}
            aria-pressed={hex.toLowerCase() === color}
            className="grid size-9 place-items-center rounded-full border border-(--color-line) hover:border-(--color-muted) aria-pressed:border-(--color-chord)"
            onClick={() => onChange(color)}
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-full"
              style={{ background: color }}
            />
          </button>
        ))}
      </div>

      {inheritLabel && (
        <Button
          size="sm"
          className="justify-self-start"
          disabled={override === undefined && draft === null}
          onClick={() => onChange(undefined)}
        >
          {inheritLabel}
        </Button>
      )}
    </div>
  );
}

function defaultColor(key: ReadingColorKey, cueStyle: CueStyle): string {
  const panel = cueAppearance(key);
  const minimal = cueStyle === 'minimal';
  const base: Partial<Record<ReadingColorKey, string>> = {
    background: 'var(--color-stage-bg)',
    chords: 'var(--color-chord)',
    bass: 'var(--color-bass)',
    titles: 'var(--color-muted)',
    info: minimal ? sectionAccentInk(key, SETUP_ACCENT) : SETUP_BACKGROUND,
    infoDetails: 'var(--color-muted)',
    Men: 'var(--color-singers-men)',
    Women: 'var(--color-singers-women)',
  };
  return (
    base[key] ??
    (panel && (minimal ? sectionAccentInk(key, panel.border) : panel.background)) ??
    (isReadingSectionColor(key) ? 'transparent' : 'var(--color-stage-fg)')
  );
}

function ReadingColorPreview({
  colorKey,
  cueStyle,
}: {
  colorKey: ReadingColorKey;
  cueStyle: CueStyle;
}) {
  const { t } = useT();
  if (colorKey === 'info' || colorKey === 'infoDetails') {
    return (
      <div className="[&>section]:mb-0">
        <PerformanceInfo
          performanceKey="G"
          displayedKey="D"
          transpose={0}
          capo={0}
          cueStyle={cueStyle}
        />
      </div>
    );
  }
  const isBlock = BLOCK_TYPES.some((type) => type === colorKey);
  const singer = SINGERS.find((who) => who === colorKey);
  const block = emptyBlock('V1', isBlock ? (colorKey as BlockType) : 'Verse');
  const line = emptyLine(t('settings.chordColorSample'));
  if (colorKey === 'chords')
    line.chords = [
      { at: 0, raw: 'G' },
      { at: 12, raw: 'D' },
    ];
  if (colorKey === 'bass')
    line.bass = [
      { at: 0, raw: 'G' },
      { at: 12, raw: 'D' },
    ];
  line.singers = singer ?? null;
  block.lines = [line];
  block.repeat = colorKey === 'repeats' ? 2 : null;

  return (
    <div className="[&_section]:mb-0">
      <SongBody
        song={{ ...SAMPLE_SONG, blocks: [block] }}
        options={{
          cueStyle: colorKey === 'titles' ? 'full' : cueStyle,
          showChords: true,
          showBass: true,
          capo: 0,
          transpose: 0,
        }}
      />
    </div>
  );
}
