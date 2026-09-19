import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { Button, Checkbox, Input } from '../components/ui.js';
import { clientDesktop, type ClientDesktopState } from '../lib/clientDesktop.js';
import { useT } from '../lib/i18n.js';

/**
 * First-run setup for the installed Band and Stage apps.
 *
 * This deliberately lives in the shared renderer rather than in a hand-written HTML
 * string in Electron. It therefore uses the exact same colours, typography, controls,
 * language, focus states, and responsive behaviour as the browser application.
 */
export function ClientSetupPage() {
  const { t } = useT();
  const native = useMemo(() => clientDesktop(), []);
  const [state, setState] = useState<ClientDesktopState | null>(null);
  const [name, setName] = useState('');
  const [showChords, setShowChords] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    void native.state().then((value) => {
      setState(value);
      setName(value.name);
      setShowChords(value.showChords);
      setAutoStart(value.autoStart);
    });
  }, [native]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!native || !trimmed) {
      setError(t('setup.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    void native.completeSetup({ name: trimmed, showChords, autoStart }).catch(() => {
      setError(t('setup.failed'));
      setSaving(false);
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-(--color-stage-bg)">
      <header className="flex h-13 shrink-0 items-center border-b border-(--color-line) bg-(--color-surface) px-3 shadow-[0_1px_0_0_var(--color-line),0_6px_16px_-12px_rgb(0_0_0/0.5)]">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Logo className="h-[18px] text-(--color-chord)" />
          <span>{t('app.name')}</span>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="grid flex-1 place-items-center px-4 py-10">
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-2xl border border-(--color-line) bg-(--color-surface) p-6 shadow-xl"
        >
          <h1 className="text-xl font-bold">{t('setup.title')}</h1>
          <p className="mt-2 text-sm text-(--color-muted)">{t('setup.hint')}</p>

          <label className="mt-6 grid gap-1.5 text-sm">
            <span>{t('band.yourName')}</span>
            <Input
              value={name}
              maxLength={60}
              autoFocus
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {state?.role === 'stage' && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <Checkbox
                checked={showChords}
                onChange={(event) => setShowChords(event.target.checked)}
              />
              {t('settings.showChords')}
            </label>
          )}

          <label className="mt-4 flex items-center gap-2 text-sm">
            <Checkbox
              checked={autoStart}
              onChange={(event) => setAutoStart(event.target.checked)}
            />
            {t('settings.autoStart')}
          </label>

          {error && (
            <p className="mt-4 text-sm text-red-500" role="alert">
              {error}
            </p>
          )}

          <Button className="mt-6" variant="primary" type="submit" disabled={!state || saving}>
            {saving ? t('app.loading') : t('setup.continue')}
          </Button>
        </form>
      </main>
    </div>
  );
}
