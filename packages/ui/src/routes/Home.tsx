import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { chooseSet, lastSet } from '../lib/lastSet.js';
import { nextSunday } from '../lib/setName.js';
import { useT } from '../lib/i18n.js';
import { Logo } from '../components/Logo.js';

/**
 * Where the app opens.
 *
 * Straight into a set, because that is the thing being worked on — the library is where
 * you go to find a song, not where you start. Which set: the one this device last had
 * open, else the newest, else a fresh one.
 *
 * The mirror is consulted first so this resolves with no host reachable; the sync is
 * only to catch a set made on another device since. Creating one *does* need the host,
 * and that is the single case where this screen has to say so rather than press on.
 */
export function Home() {
  const { t } = useT();
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<void> => {
      try {
        // Local first, so a device with no host still lands somewhere useful.
        let sets = await repo.sets();
        if (sets.length === 0) {
          await repo.sync();
          sets = await repo.sets();
        } else {
          void repo.sync();
        }
        if (cancelled) return;

        const chosen = chooseSet(sets, lastSet());
        if (chosen) {
          setTarget(chosen.id);
          return;
        }

        setCreating(true);
        const sunday = nextSunday();
        const created = await api.createSet({ title: sunday, date: sunday });
        if (!cancelled) setTarget(created.id);
      } catch {
        if (!cancelled) setError(t('set.cannotCreate'));
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (target) return <Navigate to={`/sets/${encodeURIComponent(target)}`} replace />;

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-(--color-muted)">{error}</p>
        <a href="/archive" className="mt-4 inline-block text-sm underline">
          {t('app.library')}
        </a>
      </div>
    );
  }

  // A moment, usually — but a blank page with one grey line on it looks like a failure,
  // and this is the very first thing the app shows.
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-4">
      <Logo className="h-12 animate-pulse text-(--color-chord)" label={t('app.name')} />
      <p className="text-center text-sm text-(--color-muted)">
        {creating ? t('set.creatingFirst') : t('set.opening')}
      </p>
    </div>
  );
}
