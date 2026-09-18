import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { ThemeToggle } from './ThemeToggle.js';
import { ButtonLink, IconButton, Segmented, segmentClasses } from './ui.js';
import {
  IconBack,
  IconHome,
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
 * Three destinations, not four. "Lead" used to be one of them and is now a switch on
 * the set itself — leading is a mode you turn on where the service already is, not a
 * separate screen you travel to and have to come back from.
 *
 * The performance views (`/band`, `/stage`) still opt out. Nothing belongs on a stage
 * display except the song, and a musician following the leader should not be one stray
 * tap from a settings page.
 */

export type Destination = 'home' | 'library' | 'sets' | 'settings';

const DESTINATIONS: {
  key: Destination;
  to: string;
  label: TranslationKey;
  Icon: (props: IconProps) => React.JSX.Element;
}[] = [
  { key: 'home', to: '/', label: 'nav.home', Icon: IconHome },
  { key: 'library', to: '/archive', label: 'app.library', Icon: IconLibrary },
  { key: 'sets', to: '/sets', label: 'app.sets', Icon: IconSets },
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
    /*
      A fixed bar, not a page that happens to start with links.

      `shrink-0` rather than `sticky top-0`: the page around it is one viewport tall
      (see `Page`), so the header is a real row and the content scrolls in its own box
      underneath. `--color-surface` sits one step off the page colour and a hairline
      plus a soft shadow lift it, so the chrome reads as a thing the content passes
      beneath rather than as the first row of the content.
    */
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-(--color-line) bg-(--color-surface) px-3 py-2 shadow-[0_1px_0_0_var(--color-line),0_6px_16px_-12px_rgb(0_0_0/0.5)] print:hidden sm:px-4">
      {back && (
        <IconButton label={backLabel} onClick={goBack} className="shrink-0">
          <IconBack size={17} />
        </IconButton>
      )}

      <Segmented label={t('nav.where')} className="shrink-0">
        {DESTINATIONS.map(({ key, to, label, Icon }) => (
          <Link
            key={key}
            to={to}
            aria-current={current === key ? 'page' : undefined}
            title={t(label)}
            className={segmentClasses(current === key)}
          >
            <Icon size={16} />
            {/* The label is for a mouse and a wide screen; the icon carries it on a phone. */}
            <span className="hidden sm:inline">{t(label)}</span>
          </Link>
        ))}
      </Segmented>

      {title && (
        <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto">{title}</div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {children}
        <ThemeToggle />
        {/*
          Settings is a detour, not a destination, so the same button gets you back out
          of it. Pressing it again to close what it opened is what a toggle is, and
          there is nothing else in this header that means "I am done here".
        */}
        {current === 'settings' ? (
          <IconButton label={t('settings.close')} active onClick={goBack}>
            <IconSettings size={17} />
          </IconButton>
        ) : (
          <ButtonLink
            to="/settings"
            aria-label={t('settings.title')}
            title={t('settings.title')}
            icon
          >
            <IconSettings size={17} />
          </ButtonLink>
        )}
      </div>
    </header>
  );
}
