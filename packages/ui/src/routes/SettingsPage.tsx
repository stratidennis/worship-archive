import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type Backup } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { usePrefs, type Prefs } from '../lib/settings.js';
import { useT, type Lang } from '../lib/i18n.js';
import { AppHeader } from '../components/AppHeader.js';
import { Page, Scroll } from '../components/Page.js';
import { Button as UiButton, Checkbox, Segment, Segmented } from '../components/ui.js';
import {
  confirmAction,
  desktop,
  pickTextFiles,
  saveTextFile,
  type DesktopState,
} from '../lib/desktop.js';

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
    <Page>
      <AppHeader current="settings" back />
      <Scroll>
        <div className="mx-auto max-w-2xl px-4 pb-16 pt-5">
          <h1 className="mb-5 text-2xl font-bold">{t('settings.title')}</h1>

          {message && (
            <p
              className="mb-4 rounded-lg border border-(--color-line) p-3 text-sm"
              role="status"
            >
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

          <Section title={t('settings.language')}>
            <Choice<Lang>
              value={lang}
              onChange={setLang}
              options={[
                ['ro', 'Română'],
                ['en', 'English'],
              ]}
              label={t('settings.language')}
            />
          </Section>

          <Section title={t('settings.theme')}>
            <Choice<Prefs['theme']>
              value={prefs.theme}
              onChange={(theme) => setPrefs({ theme })}
              options={[
                ['auto', t('settings.themeAuto')],
                ['light', t('settings.themeLight')],
                ['dark', t('settings.themeDark')],
                ['stage', t('settings.themeStage')],
              ]}
              label={t('settings.theme')}
            />
            {prefs.theme === 'stage' && (
              <p className="mt-2 text-xs text-(--color-muted)">
                {t('settings.themeStageHint')}
              </p>
            )}
          </Section>

          <Section title={t('settings.display')}>
            <label className="block">
              <span className="flex items-baseline justify-between text-sm">
                {t('settings.maxFont')}
                <span className="font-mono text-xs text-(--color-muted)">
                  {prefs.maxFontPx}px
                </span>
              </span>
              <input
                type="range"
                min={14}
                max={72}
                step={1}
                value={prefs.maxFontPx}
                onChange={(event) => setPrefs({ maxFontPx: Number(event.target.value) })}
                className="mt-1 w-full cursor-pointer accent-(--color-chord)"
              />
              <span className="mt-1 block text-xs text-(--color-muted)">
                {t('settings.maxFontHint')}
              </span>
            </label>

            <Toggle
              checked={prefs.showChords}
              onChange={(showChords) => setPrefs({ showChords })}
              label={t('settings.showChords')}
            />
          </Section>

          <Section title={t('settings.library')}>
            {state && (
              <p className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-(--color-muted)">
                  {t('settings.dataDir')}
                </span>
                <code className="mt-0.5 block break-all rounded bg-(--color-line) px-1.5 py-1 text-xs">
                  {state.dataDir}
                </code>
              </p>
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
      </Scroll>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-(--color-line) p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: [T, string][];
  label: string;
}) {
  return (
    <Segmented label={label}>
      {options.map(([option, text]) => (
        <Segment
          key={option}
          active={value === option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {text}
        </Segment>
      ))}
    </Segmented>
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
