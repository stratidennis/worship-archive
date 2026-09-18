import { Link } from 'react-router-dom';
import { useT, type TranslationKey } from '../lib/i18n.js';

/**
 * Getting between the five places in the app.
 *
 * One component rather than a row of links per page, because that is what the app had
 * and it drifted: some pages offered a way home, some offered a small text link back to
 * wherever you probably came from, and the library — the page you are most likely to
 * wander into — offered no way back to the set at all.
 *
 * The performance views (`/band`, `/stage`) deliberately do not use this. Nothing
 * belongs on a stage display except the song, and a musician following the leader
 * should not be one stray tap from a settings page.
 */

export type Destination = 'home' | 'library' | 'sets' | 'lead' | 'settings';

const DESTINATIONS: { key: Destination; to: string; label: TranslationKey }[] = [
  { key: 'home', to: '/', label: 'nav.home' },
  { key: 'library', to: '/library', label: 'app.library' },
  { key: 'sets', to: '/sets', label: 'app.sets' },
  { key: 'lead', to: '/lead', label: 'app.lead' },
];

export function NavBar({
  current,
  back,
  children,
}: {
  /** Marked as the current page, and not offered as a link to itself. */
  current?: Destination;
  /** A step back up, for pages that are inside something else. */
  back?: { to: string; label: string };
  /** Page-specific actions, kept to the right of the destinations. */
  children?: React.ReactNode;
}) {
  const { t } = useT();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {back && (
        <Link
          to={back.to}
          className="rounded-lg border border-(--color-line) px-2.5 py-2 text-sm font-medium hover:bg-(--color-line)"
        >
          ← {back.label}
        </Link>
      )}

      <nav aria-label={t('nav.where')} className="flex flex-wrap items-center gap-1.5">
        {DESTINATIONS.map((destination) => (
          <Link
            key={destination.key}
            to={destination.to}
            aria-current={current === destination.key ? 'page' : undefined}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              current === destination.key
                ? 'border-(--color-chord) bg-(--color-chord)/15 text-(--color-chord)'
                : 'border-(--color-line) hover:bg-(--color-line)'
            }`}
          >
            {t(destination.label)}
          </Link>
        ))}
        <Link
          to="/settings"
          aria-current={current === 'settings' ? 'page' : undefined}
          aria-label={t('settings.title')}
          title={t('settings.title')}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            current === 'settings'
              ? 'border-(--color-chord) bg-(--color-chord)/15 text-(--color-chord)'
              : 'border-(--color-line) hover:bg-(--color-line)'
          }`}
        >
          ⚙
        </Link>
      </nav>

      {children && (
        <span className="ml-auto flex flex-wrap items-center gap-2">{children}</span>
      )}
    </div>
  );
}

/**
 * The same idea for a dense header, where a row of chips would not fit.
 *
 * The song view, the editor and the leader console all have a crowded toolbar already;
 * they get one button home rather than five.
 */
export function HomeButton({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <Link
      to="/"
      aria-label={t('nav.homeHint')}
      title={t('nav.homeHint')}
      className={`rounded-md border border-(--color-line) px-2 py-1 text-sm hover:bg-(--color-line) ${className}`}
    >
      ⌂
    </Link>
  );
}
