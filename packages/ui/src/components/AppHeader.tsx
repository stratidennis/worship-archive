import { useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { useHeaderSlots } from './header-slots.js';
import { Logo } from './Logo.js';
import { ThemeToggle } from './ThemeToggle.js';
import { ButtonLink, IconButton } from './ui.js';
import { IconBack, IconLibrary, IconSets, IconSettings, type IconProps } from './icons.js';

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
 * ## Weight
 *
 * The rework this went through was about one thing: there were eight bordered boxes in
 * a row — back, logo, a segmented nav, a date, a page action, a toggle, a theme button,
 * a settings button — every one of them the same height and the same weight, so nothing
 * looked more important than anything else and the whole bar read as clutter.
 *
 * Now there are two tiers. **Page actions keep their borders**, because they are the
 * thing this screen does. **Navigation and app chrome do not**: they are quiet until
 * hovered, and where-you-are is a soft tinted pill rather than a solid fill. A hairline
 * separates the two on the right, so the eye reads "what this page does" and "what the
 * app does" as different groups instead of one long row of buttons.
 *
 * The logo is the Home link's icon rather than a picture sitting beside the nav. As
 * decoration it was the least useful pixel in the densest row of the app; as the
 * home button it is the oldest convention on the web and costs no width at all.
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
  Icon: ((props: IconProps) => React.JSX.Element) | null;
}[] = [
  // `null` means the mark: Home is the one destination that is also the brand.
  { key: 'home', to: '/', label: 'nav.home', Icon: null },
  { key: 'library', to: '/archive', label: 'app.library', Icon: IconLibrary },
  { key: 'sets', to: '/sets', label: 'app.sets', Icon: IconSets },
];

/** Where you are: a tint, not a fill. A fill on every bar makes the bar the subject. */
const HERE = 'bg-(--color-chord)/15 text-(--color-chord)';
const QUIET = 'text-(--color-muted) hover:bg-(--color-line) hover:text-(--color-stage-fg)';

/**
 * Mounted once, by the layout route, and never again.
 *
 * It takes no props: pages say where they are with `useHeader` and put their own
 * controls in through `<HeaderTitle>` and `<HeaderActions>`. That is the whole reason
 * this moved — see `header-slots.tsx`.
 */
export function AppHeader() {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { placement, setHosts } = useHeaderSlots();
  const { current, back } = placement;

  // Callback refs, updating one field each: React calls them when it attaches and
  // detaches the node, and the functional form means neither has to know the other's
  // current value to leave it alone.
  const titleRef = useCallback(
    (node: HTMLDivElement | null) => setHosts((current) => ({ ...current, title: node })),
    [setHosts],
  );
  const actionsRef = useCallback(
    (node: HTMLDivElement | null) => setHosts((current) => ({ ...current, actions: node })),
    [setHosts],
  );

  const goBack = (): void => {
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
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-(--color-line) bg-(--color-surface) px-2 py-1.5 shadow-[0_1px_0_0_var(--color-line),0_6px_16px_-12px_rgb(0_0_0/0.5)] print:hidden sm:px-3">
      <nav aria-label={t('nav.where')} className="flex shrink-0 items-center gap-0.5">
        {DESTINATIONS.map(({ key, to, label, Icon }) => (
          <Link
            key={key}
            to={to}
            aria-current={current === key ? 'page' : undefined}
            title={t(label)}
            className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors ${
              current === key ? HERE : QUIET
            }`}
          >
            {/* Home's icon is the mark, which is why it is drawn rather than a
                picture: it takes the link's own colour like every other icon here —
                muted elsewhere, accent when you are here, following the hover in
                between — and a PNG could only ever be one colour. */}
            {Icon ? <Icon size={17} /> : <Logo className="h-[18px]" />}
            {/* The label is for a mouse and a wide screen; the icon carries it on a phone. */}
            <span className="hidden sm:inline">{t(label)}</span>
          </Link>
        ))}
      </nav>

      {/*
        Back sits after the navigation, not before it.

        In front, it moved the logo and all three destinations sideways on every page
        that had one — so the thing you aim at to get Home was in a different place
        depending on where you were, which is the one thing a fixed navigation bar
        exists to prevent. Here it leads the page's own side of the header: the app's
        controls are pinned to the left edge and never move, and what changes is
        grouped with the rest of what changes.
      */}
      {back && (
        <IconButton
          variant="ghost"
          label={t('app.back')}
          onClick={goBack}
          className="ml-1 shrink-0"
        >
          <IconBack size={17} />
        </IconButton>
      )}

      {/* `empty:hidden` matters: `basis-full` on an empty box would still claim a whole
          second row on every page that contributes no title. */}
      <div
        ref={titleRef}
        className="order-last min-w-0 basis-full empty:hidden sm:order-none sm:basis-auto sm:pl-1"
      />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* What the page does, then what the app does — with a hairline between them,
            drawn by the actions themselves so it cannot appear beside nothing. */}
        <div
          ref={actionsRef}
          className="flex items-center gap-1.5 [&:not(:empty)]:mr-1 [&:not(:empty)]:border-r [&:not(:empty)]:border-(--color-line) [&:not(:empty)]:pr-2.5"
        />

        <ThemeToggle />
        {/*
          Settings is a detour, not a destination, so the same button gets you back out
          of it. Pressing it again to close what it opened is what a toggle is, and
          there is nothing else in this header that means "I am done here".
        */}
        {current === 'settings' ? (
          <IconButton
            variant="ghost"
            label={t('settings.close')}
            onClick={goBack}
            className={HERE}
          >
            <IconSettings size={17} />
          </IconButton>
        ) : (
          <ButtonLink
            to="/settings"
            variant="ghost"
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
