import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  BLOCK_TYPES,
  READING_TEXT_COLORS,
  SINGERS,
  emptyBlock,
  emptyLine,
  isReadingColor,
  parseChordPro,
  type BlockType,
  type ReadingColorKey,
  type ReadingColors,
} from '@worship/core';
import { usePrefs } from '../lib/settings.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { readingColorStyle } from '../lib/readingColors.js';
import { SectionHighlight } from './DisplaySettings.js';
import { PerformanceInfo } from './PerformanceInfo.js';
import { SongBody, singerInk } from './SongBody.js';
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
  background: 'settings.colors.background',
  titles: 'settings.colors.titles',
  repeats: 'edit.repeats',
  info: 'performance.title',
  infoDetails: 'settings.colors.infoDetails',
};

type ColorChange = (key: ReadingColorKey, color: string | null | undefined) => void;

export function DeviceReadingColorSettings() {
  const { t } = useT();
  const [prefs, setPrefs] = usePrefs();
  return (
    <ReadingColorSettings
      colors={prefs.readingColors}
      theme={prefs.theme}
      onChange={(key, value) => {
        const readingColors = { ...prefs.readingColors };
        if (value === undefined) delete readingColors[key];
        else readingColors[key] = value;
        setPrefs({
          readingColors,
          ...(key === 'chords' ? { chordColor: value ?? null } : {}),
          ...(value && key === 'Bridge' ? { highlightBridges: true } : {}),
          ...(value && key === 'Solo' ? { highlightSolos: true } : {}),
        });
      }}
    >
      <SectionHighlight
        label={t('settings.highlightBridges')}
        value={prefs.highlightBridges}
        onChange={(highlightBridges) => setPrefs({ highlightBridges })}
      />
      <SectionHighlight
        label={t('settings.highlightSolos')}
        value={prefs.highlightSolos}
        onChange={(highlightSolos) => setPrefs({ highlightSolos })}
      />
    </ReadingColorSettings>
  );
}

export function ReadingColorSettings({
  colors,
  inherited,
  inheritLabel,
  theme,
  onChange,
  children,
}: {
  colors: ReadingColors;
  inherited?: ReadingColors;
  inheritLabel?: string;
  theme?: 'auto' | 'dark' | 'light';
  onChange: ColorChange;
  children?: React.ReactNode;
}) {
  const { t, blockName, singerName } = useT();
  const id = useId();
  const [key, setKey] = useState<ReadingColorKey>('chords');
  const effective = { ...inherited, ...colors };
  return (
    <section aria-labelledby={id} className="mt-5 border-t border-(--color-line) pt-4">
      <h3 id={id} className="text-base font-semibold">
        {t('settings.colors.title')}
      </h3>
      <label className="mt-3 grid max-w-xl gap-1.5 text-sm">
        <span>{t('settings.colors.edit')}</span>
        <Select value={key} onChange={(event) => setKey(event.target.value as ReadingColorKey)}>
          <optgroup label={t('settings.colors.textAndMusic')}>
            {READING_TEXT_COLORS.map((item) => (
              <option key={item} value={item}>
                {t(TEXT_LABELS[item])}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('settings.colors.sections')}>
            {BLOCK_TYPES.map((item) => (
              <option key={item} value={item}>
                {blockName(item)}
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
        key={`${key}:${colors[key] ?? (colors[key] === null ? 'default' : 'inherited')}:${effective[key] ?? ''}`}
        colorKey={key}
        colors={effective}
        override={colors[key]}
        inheritLabel={inheritLabel}
        theme={theme}
        onChange={(value) => onChange(key, value)}
      />
      <div className="mt-2 flex flex-wrap gap-x-5">{children}</div>
    </section>
  );
}

function ColorEditor({
  colorKey,
  colors,
  override,
  inheritLabel,
  theme,
  onChange,
}: {
  colorKey: ReadingColorKey;
  colors: ReadingColors;
  override: string | null | undefined;
  inheritLabel: string | undefined;
  theme: 'auto' | 'light' | 'dark' | undefined;
  onChange: (color: string | null | undefined) => void;
}) {
  const { t } = useT();
  const hexId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [defaultHex, setDefaultHex] = useState('#000000');
  const swatch = useRef<HTMLSpanElement>(null);
  const saved = colors[colorKey];
  const hex = draft ?? saved ?? defaultHex;
  const valid = isReadingColor(hex);
  const draftColors = valid && draft !== null ? { ...colors, [colorKey]: hex } : colors;

  // A native color input takes sRGB hex. Sample the actual theme color, including
  // CSS colors such as oklch, so it opens at the color currently shown.
  useLayoutEffect(() => {
    if (!swatch.current || saved) return;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(swatch.current).color;
    ctx.fillRect(0, 0, 1, 1);
    const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    setDefaultHex('#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join(''));
  }, [colorKey, saved, theme]);

  const change = (value: string | null | undefined): void => {
    setDraft(null);
    onChange(value);
  };
  const canApply = valid && draft !== null && hex.toLowerCase() !== override?.toLowerCase();
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
        <ReadingColorPreview colorKey={colorKey} />
        <span
          ref={swatch}
          aria-hidden="true"
          className="hidden"
          style={{ color: previewInk(colorKey) }}
        />
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canApply) change(hex.toLowerCase());
        }}
      >
        <input
          type="color"
          aria-label={t('settings.colors.pick')}
          value={valid ? hex : (saved ?? defaultHex)}
          onChange={(event) => setDraft(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-(--color-line) bg-(--color-surface) p-1"
        />
        <label className="grid gap-1 text-xs" htmlFor={hexId}>
          {t('settings.colors.hex')}
          <Input
            id={hexId}
            value={hex}
            aria-invalid={!valid || undefined}
            spellCheck={false}
            maxLength={7}
            onChange={(event) => setDraft(event.target.value)}
            className="w-28 font-mono"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!canApply}>
          {t('settings.colors.apply')}
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([color, label]) => (
          <button
            key={color}
            type="button"
            title={t(`settings.colors.preset.${label}`)}
            aria-label={t(`settings.colors.preset.${label}`)}
            aria-pressed={hex.toLowerCase() === color}
            className="grid size-8 place-items-center rounded-full border border-(--color-line) hover:border-(--color-muted) aria-pressed:border-(--color-chord)"
            onClick={() => setDraft(color)}
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-full"
              style={{ background: color }}
            />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {inheritLabel && (
          <Button
            size="sm"
            disabled={override === undefined && draft === null}
            onClick={() => change(undefined)}
          >
            {inheritLabel}
          </Button>
        )}
        <Button
          size="sm"
          disabled={(inheritLabel ? override === null : override == null) && draft === null}
          onClick={() => change(inheritLabel ? null : undefined)}
        >
          {t('settings.colors.themeDefault')}
        </Button>
      </div>
    </div>
  );
}

function previewInk(key: ReadingColorKey): string {
  const base: Partial<Record<ReadingColorKey, string>> = {
    background: 'var(--color-stage-bg)',
    chords: 'var(--color-chord)',
    bass: 'var(--color-bass)',
    titles: 'var(--color-muted)',
    info: 'var(--color-chord)',
    infoDetails: 'var(--reading-info, var(--color-muted))',
    Intro: 'var(--color-cue-intro)',
    Instrumental: 'var(--color-cue-instrumental)',
    Note: 'var(--color-cue-note)',
    Solo: 'var(--color-solo-ink)',
    Bridge: 'var(--color-bridge-ink)',
  };
  if (key === 'Men' || key === 'Women') return singerInk(key)!;
  return `var(--reading-${key}, ${base[key] ?? 'var(--color-stage-fg)'})`;
}

function ReadingColorPreview({ colorKey }: { colorKey: ReadingColorKey }) {
  const { t } = useT();
  if (colorKey === 'info' || colorKey === 'infoDetails') {
    return (
      <div className="[&>section]:mb-0">
        <PerformanceInfo performanceKey="G" displayedKey="D" transpose={0} capo={0} />
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
          cueStyle: colorKey === 'titles' ? 'full' : 'compact',
          showChords: true,
          showBass: true,
          capo: 0,
          transpose: 0,
          highlightBridges: true,
          highlightSolos: true,
        }}
      />
    </div>
  );
}
