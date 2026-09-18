import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { ThemeToggle } from './ThemeToggle.js';
import {
  IconBack,
  IconHome,
  IconLead,
  IconLibrary,
  IconSets,
  IconSettings,
  type IconProps,
} from './icons.js';

/**
 * The one header, on every page.
 *
 * Previously each page arranged its own: a different set of links, in a different
 * order, with a different idea of what "back" meant. Being able to tell at a glance
 * where you are and get anywhere from here matters more during a service than any
 * per-page tailoring, so pages now contribute *actions* and nothing else.
 *
 * The performance views (`/band`, `/stage`) still opt out. Nothing belongs on a stage
 * display except the song, and a musician following the leader should not be one stray
 * tap from a settings page.
 */

export type Destination = 'home' | 'library' | 'sets' | 'lead' | 'settings';

const DESTINATIONS: {
  key: Destination;
  to: string;
  label: TranslationKey;
  Icon: (props: IconProps) => React.JSX.Element;
}[] = [
  { key: 'home', to: '/', label: 'nav.home', Icon: IconHome },
  { key: 'library', to: '/library', label: 'app.library', Icon: IconLibrary },
  { key: 'sets', to: '/sets', label: 'app.sets', Icon: IconSets },
  { key: 'lead', to: '/lead', label: 'app.lead', Icon: IconLead },
];

export function AppHeader({
  current,
  back,
  title,
  children,
}: {
  current?: Destination;
  /**
   * A way back out. Without `to` it returns through history, which is what "where I
   * came from" actually means — a song opened from a set goes back to that set, and the
   * same song opened from the library goes back to the library.
   */
  back?: { to?: string; label?: string } | true;
  /** Shown beside the navigation rather than as a separate heading row. */
  title?: React.ReactNode;
  /** Page actions, kept to the right so they never compete with navigation. */
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();

  const backTo = back === true ? undefined : back?.to;
  const backLabel = (back === true ? undefined : back?.label) ?? t('app.back');

  const goBack = (): void => {
    if (backTo) {
      navigate(backTo);
      return;
    }
    // `idx` is React Router's position in its own history stack. At zero there is
    // nothing of ours behind us — a deep link, or a fresh tab — and going back would
    // leave the app entirely.
    const idx = (location as { key?: string; state?: unknown } & { idx?: number }).idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-(--color-line) px-3 py-2 print:hidden sm:px-4">
      {back && (
        <button
          type="button"
          onClick={goBack}
          aria-label={backLabel}
          title={backLabel}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-(--color-line) hover:bg-(--color-line)"
        >
          <IconBack size={17} />
        </button>
      )}

      <nav aria-label={t('nav.where')} className="flex shrink-0 items-center gap-1">
        {DESTINATIONS.map(({ key, to, label, Icon }) => (
          <Link
            key={key}
            to={to}
            aria-current={current === key ? 'page' : undefined}
            title={t(label)}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium ${
              current === key
                ? 'border-(--color-chord) bg-(--color-chord)/15 text-(--color-chord)'
                : 'border-(--color-line) hover:bg-(--color-line)'
            }`}
          >
            <Icon size={16} />
            {/* The label is for a mouse and a wide screen; the icon carries it on a phone. */}
            <span className="hidden sm:inline">{t(label)}</span>
          </Link>
        ))}
      </nav>

      {title && (
        <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto">{title}</div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {children}
        <ThemeToggle />
        <Link
          to="/settings"
          aria-current={current === 'settings' ? 'page' : undefined}
          aria-label={t('settings.title')}
          title={t('settings.title')}
          className={`grid h-9 w-9 place-items-center rounded-lg border ${
            current === 'settings'
              ? 'border-(--color-chord) bg-(--color-chord)/15 text-(--color-chord)'
              : 'border-(--color-line) hover:bg-(--color-line)'
          }`}
        >
          <IconSettings size={17} />
        </Link>
      </div>
    </header>
  );
}
