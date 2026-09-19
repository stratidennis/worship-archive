import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type Backup } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { usePrefs } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { Scroll } from '../components/Scroll.js';
import { useHeader } from '../components/header-slots.js';
import {
  ChordColour,
  ChordSample,
  AccidentalChoice,
  FontSize,
  LanguageChoice,
  ThemeChoice,
} from '../components/DisplaySettings.js';
import { useStageDisplay } from '../lib/stageDisplay.js';
import { DEFAULT_STAGE_DISPLAY, type StageDisplay } from '@worship/core';
import { confirmAction } from '../lib/confirm.js';
import { Button as UiButton, Checkbox, Segment, Segmented } from '../components/ui.js';
import { desktop, pickTextFiles, saveTextFile, type DesktopState } from '../lib/desktop.js';

/**
 * Everything that is a setting, in one place.
 *
 * Split by who it belongs to, which is the distinction that actually matters here:
 * language, theme and text size are **this device's**, and live in localStorage; the
 * song folder and the backups are **the library's**, and live on the host. A guitarist
 * changing their font size must not change anyone else's, and that is why they are not
 * presented as the same kind of thing.
 */
export function SettingsPage() {
  const { t, lang, setLang } = useT();
  const [prefs, setPrefs] = usePrefs();
  const [native] = useState(() => desktop());
  const [state, setState] = useState<DesktopState | null>(null);
  const [mirror, setMirror] = useState<{ songs: number; lastSync: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useHeader({ current: 'settings', back: true });

  /** Whose screen these settings are about: this one, or the ones on the wall. */
  const [target, setTarget] = useState<'device' | 'stage'>('device');
  /** Within the screens: all of them together, or one in particular. */
  const [screen, setScreen] = useState<string | null>(null);
  const {
    shared,
    byScreen,
    screens,
    unnamed,
    save: saveStage,
    reachable: stageReachable,
  } = useStageDisplay();

  /*
    A screen that has been switched off and never had settings of its own drops out of
    the list, and the selection has to drop with it — otherwise the controls would be
    editing a screen that no longer appears anywhere above them.
  */
  const selected = screen !== null && screens.some((s) => s.id === screen) ? screen : null;
  const stage = selected ? (byScreen[selected] ?? DEFAULT_STAGE_DISPLAY) : shared;
  /**
   * One screen inherits from all screens; all screens inherit from this one.
   *
   * That last step is the whole point of the default: a television has no settings
   * anybody chose, so "leave it alone" meant "leave it at whatever a fresh browser
   * does" — which is how a leader working in English ended up with Romanian on the
   * wall. Left alone, the screens now look like the screen being led from.
   */
  const inherit = selected ? t('settings.asAllScreens') : t('settings.asThisDevice');
  const setStage = (patch: Partial<StageDisplay>): void => saveStage(selected, patch);

  useEffect(() => {
    void native?.state().then(setState);
    void repo.status().then(setMirror);
  }, [native]);

  const downloadBackup = async (): Promise<void> => {
    setBusy(true);
    try {
      const backup = await adminApi.backup();
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
      await saveTextFile(`worship-archive-${stamp}.json`, JSON.stringify(backup, null, 2));
      setMessage(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (mode: 'merge' | 'replace'): Promise<void> => {
    if (mode === 'replace') {
      const ok = await confirmAction({
        message: t('settings.restore'),
        detail: t('settings.restoreConfirm'),
        confirmLabel: t('settings.restoreReplace'),
        danger: true,
      });
      if (!ok) return;
    }
    const files = await pickTextFiles('.json,application/json', false);
    const file = files[0];
    if (!file) return;

    setBusy(true);
    try {
      const parsed = JSON.parse(file.text) as Backup;
      const result = await adminApi.restore(parsed, mode);
      setMessage(t('settings.restored', { songs: result.songs, sets: result.sets }));
      setError(null);
      await repo.sync();
      setMirror(await repo.status());
    } catch (e: unknown) {
      setError(t('settings.restoreFailed', { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Scroll>
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-8">
        <h1 className="mb-4 text-2xl font-bold">{t('settings.title')}</h1>

        {message && (
          <p className="mb-4 rounded-lg border border-(--color-line) p-3 text-sm" role="status">
            {message}
          </p>
        )}
        {error && (
          <p
            className="mb-4 rounded-lg border border-red-500/40 p-3 text-sm text-red-500"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* A real grid, not CSS columns. Column balancing moved whole cards whenever
            the Display card changed height, which made the page rearrange itself as a
            setting was selected. Grid order is stable and its two wider columns leave
            enough room for paths, screen names, and segmented controls. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('settings.language')}>
            <LanguageChoice value={lang} onChange={setLang} />
          </Section>

          <Section title={t('settings.theme')}>
            <ThemeChoice value={prefs.theme} onChange={(theme) => setPrefs({ theme })} />
          </Section>

          <Section title={t('settings.display')} className="lg:col-span-2">
            {/*
              The same four questions, asked of two different things.

              A leader sets up their own laptop and also the televisions on the wall,
              which have nobody standing at them — and those are genuinely different
              answers: the screen at the back of a hall wants enormous text, and the
              laptop on the music stand does not. A switch over one set of controls says
              that more plainly than two sections saying nearly the same words.
            */}
            <Segmented label={t('settings.displayTarget')} className="mb-4">
              <Segment active={target === 'device'} onClick={() => setTarget('device')}>
                {t('settings.thisDevice')}
              </Segment>
              <Segment active={target === 'stage'} onClick={() => setTarget('stage')}>
                {t('settings.theScreens')}
              </Segment>
            </Segmented>

            {target === 'device' ? (
              <>
                <FontSize
                  value={prefs.maxFontPx}
                  onChange={(maxFontPx) => setPrefs({ maxFontPx })}
                />
                <Toggle
                  checked={prefs.showChords}
                  onChange={(showChords) => setPrefs({ showChords })}
                  label={t('settings.showChords')}
                />
                <ChordColour
                  value={prefs.chordColor}
                  onChange={(chordColor) => setPrefs({ chordColor })}
                />
                <ChordSample />
              </>
            ) : (
              <>
                {/*
                  Which of them, when there is more than one.

                  A hall with a screen at the back and a monitor by the drums does not
                  want one answer: "large enough to read from thirty metres" and "large
                  enough for the bass player" are different numbers. Screens are listed
                  by the name in their own address — the same name the leader sees in
                  the connected list — because a connection id means nothing to anyone
                  and is forgotten the moment the television is switched off.
                */}
                {screens.length > 0 && (
                  <div
                    role="group"
                    aria-label={t('settings.whichScreen')}
                    className="mb-3 flex flex-wrap gap-1.5"
                  >
                    <UiButton
                      size="sm"
                      active={selected === null}
                      onClick={() => setScreen(null)}
                    >
                      {t('settings.allScreens')}
                    </UiButton>
                    {screens.map((one) => (
                      <UiButton
                        key={one.id}
                        size="sm"
                        active={selected === one.id}
                        onClick={() => setScreen(one.id)}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background: one.connected ? 'var(--color-ok)' : 'var(--color-line)',
                          }}
                        />
                        {one.name}
                        {!one.connected && (
                          <span className="opacity-60">{t('settings.screenOff')}</span>
                        )}
                      </UiButton>
                    ))}
                  </div>
                )}

                <p className="mb-3 text-xs text-(--color-muted)">
                  {!stageReachable
                    ? t('settings.stageOffline')
                    : selected
                      ? t('settings.screenHint')
                      : t('settings.stageHint')}
                </p>
                {stageReachable && selected === null && unnamed > 0 && (
                  <p className="mb-3 text-xs text-(--color-muted)">
                    {t('settings.unnamedScreens')}
                  </p>
                )}

                <LanguageChoice
                  label={t('settings.language')}
                  value={stage.language}
                  onChange={(language) => setStage({ language })}
                  inherit={inherit}
                />
                <ThemeChoice
                  label={t('settings.theme')}
                  value={stage.theme}
                  onChange={(theme) => setStage({ theme })}
                  inherit={inherit}
                />
                {/* Size is the one thing the screens do not take from here: a ceiling
                    for a laptop on a music stand is not a ceiling for a television
                    across a hall. Cleared, it is the screens' own generous default. */}
                <FontSize
                  value={stage.maxFontPx}
                  onChange={(maxFontPx) => setStage({ maxFontPx })}
                  onClear={() => setStage({ maxFontPx: null })}
                  clearLabel={selected ? inherit : t('settings.chordColorDefault')}
                  fallback={(selected ? shared.maxFontPx : null) ?? 72}
                />
                {/* Whether chords are shown belongs to a physical display, not to an
                    abstract "all screens" default. It is offered only after the
                    Leader has selected a named, connected-or-remembered screen. */}
                {selected && (
                  <StageChordChoice
                    value={stage.showChords}
                    onChange={(showChords) => setStage({ showChords })}
                  />
                )}
                <ChordColour
                  value={stage.chordColor}
                  onChange={(chordColor) => setStage({ chordColor })}
                  defaultLabel={inherit}
                />
                <ChordSample colour={stage.chordColor} />
              </>
            )}
          </Section>

          <Section title={t('settings.accidentals')} className="lg:col-span-2">
            <AccidentalChoice
              value={prefs.accidentalPreferences}
              onChange={(accidentalPreferences) => setPrefs({ accidentalPreferences })}
            />
          </Section>

          <Section title={t('settings.library')}>
            {state && (
              <div className="grid gap-2 text-sm">
                <span className="block text-xs uppercase tracking-wide text-(--color-muted)">
                  {t('settings.dataDir')}
                </span>
                <code className="mt-0.5 block break-all rounded bg-(--color-line) px-1.5 py-1 text-xs">
                  {state.dataDir}
                </code>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-(--color-muted)">{t('settings.songsDir')}</dt>
                  <dd className="min-w-0 break-all font-mono">{state.songsDir}</dd>
                  <dt className="text-(--color-muted)">{t('settings.setsDir')}</dt>
                  <dd className="min-w-0 break-all font-mono">{state.setsDir}</dd>
                </dl>
              </div>
            )}
            {native && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => void native.revealDataDir()}>
                  {t('settings.revealDataDir')}
                </Button>
                <Button onClick={() => void native.chooseDataDir()}>
                  {t('settings.chooseDataDir')}
                </Button>
                <span className="w-full text-xs text-(--color-muted)">
                  {t('settings.chooseDataDirHint')}
                </span>
              </div>
            )}

            <p className="mt-3 text-sm text-(--color-muted)">
              {t('settings.mirror', { songs: mirror?.songs ?? 0 })} ·{' '}
              {mirror?.lastSync
                ? t('settings.lastSync', { when: new Date(mirror.lastSync).toLocaleString() })
                : t('settings.neverSynced')}
            </p>
            <Button
              onClick={() => {
                void repo.sync().then(() => repo.status().then(setMirror));
              }}
            >
              {t('settings.resync')}
            </Button>
          </Section>

          <Section title={t('settings.connections')}>
            <p className="text-sm text-(--color-muted)">{t('settings.connectionsHint')}</p>
            <Link
              to="/join"
              className="mt-3 inline-flex h-8 items-center rounded-md border border-(--color-line) px-2.5 text-sm font-medium hover:bg-(--color-line)"
            >
              {t('settings.openJoin')}
            </Link>
          </Section>

          <Section title={t('settings.backup')}>
            <p className="text-xs text-(--color-muted)">{t('settings.backupHint')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void downloadBackup()} disabled={busy}>
                {t('settings.download')}
              </Button>
              <Button onClick={() => void restore('merge')} disabled={busy}>
                {t('settings.restoreMerge')}
              </Button>
              <Button onClick={() => void restore('replace')} disabled={busy} danger>
                {t('settings.restoreReplace')}
              </Button>
            </div>
          </Section>

          <Section title={t('settings.cleanup')}>
            <p className="text-xs text-(--color-muted)">{t('settings.cleanupHint')}</p>
            <Link
              to="/cleanup"
              className="mt-2 inline-block rounded-md border border-(--color-line) px-2.5 py-1.5 text-sm hover:bg-(--color-line)"
            >
              {t('settings.openCleanup')}
            </Link>
          </Section>

          {native && state && (
            <Section title={t('settings.desktop')}>
              <Toggle
                checked={state.preventSleep}
                onChange={(on) => {
                  void native
                    .setPreventSleep(on)
                    .then((value) =>
                      setState((current) =>
                        current ? { ...current, preventSleep: value } : current,
                      ),
                    );
                }}
                label={t('settings.preventSleep')}
                hint={t('settings.preventSleepHint')}
              />
              <Toggle
                checked={state.autoStart}
                onChange={(on) => {
                  void native
                    .setAutoStart(on)
                    .then((value) =>
                      setState((current) =>
                        current ? { ...current, autoStart: value } : current,
                      ),
                    );
                }}
                label={t('settings.autoStart')}
              />
              <p className="mt-2 text-xs text-(--color-muted)">
                {t('settings.version', { version: state.version })}
              </p>
            </Section>
          )}
        </div>
      </div>
    </Scroll>
  );
}

function Section({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`h-full rounded-xl border border-(--color-line) p-5 ${className}`}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StageChordChoice({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  const { t } = useT();
  return (
    <div className="mt-3">
      <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-(--color-muted)">
        {t('song.chords')}
      </span>
      <Segmented label={t('song.chords')} className="max-w-full flex-wrap">
        <Segment active={value !== false} onClick={() => onChange(true)}>
          {t('settings.chordsShown')}
        </Segment>
        <Segment active={value === false} onClick={() => onChange(false)}>
          {t('settings.chordsHidden')}
        </Segment>
      </Segmented>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="mt-2 flex items-start gap-2 text-sm">
      <Checkbox
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-(--color-muted)">{hint}</span>}
      </span>
    </label>
  );
}

/** The settings page's buttons, which are the shared control with a shorter name. */
function Button({
  onClick,
  children,
  disabled,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <UiButton
      size="sm"
      variant={danger ? 'danger' : 'default'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </UiButton>
  );
}
