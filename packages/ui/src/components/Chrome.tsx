import { Outlet } from 'react-router-dom';
import { AppHeader } from './AppHeader.js';
import { DevicesPanel } from './DevicesPanel.js';
import { HeaderSlotsProvider } from './header-slots.js';
import { useHostAppearance } from '../lib/hostAppearance.js';

/**
 * The shell every page with navigation lives inside.
 *
 * A layout route, so the header is mounted once for the life of the app instead of
 * once per page. That is the whole point of it: the header is the one thing on screen
 * that does not change when you go somewhere, and it was being torn down and rebuilt on
 * every click — the logo blinked, focus was lost, the bar flickered.
 *
 * It also owns the viewport-height box the pages used to each declare for themselves.
 * Pages are now simply the thing under the header: either a `Scroll` (a document) or a
 * `flex min-h-0 flex-1` column (a workspace that manages its own panes).
 *
 * `/band` and `/stage` sit outside this. Nothing belongs on a stage display except the
 * song, and a musician following the leader should not be one stray tap from a settings
 * page.
 */
export function Chrome() {
  /*
    Here, and not above the router, because *this* is the set of pages the leader uses.

    A television plugged into the host laptop is opened at `localhost/stage`, which
    looks exactly like the leader's own browser to anything checking the address — so
    published from the app shell it would announce the screen's appearance as the
    thing the screens should follow, and a screen would end up following itself.
    `/stage` and `/band` live outside this route on purpose; letting that fact do the
    work is better than another test of who is who.
  */
  useHostAppearance();

  return (
    <HeaderSlotsProvider>
      <div className="flex h-dvh flex-col print:block print:h-auto">
        <AppHeader />
        {/* The page, and beside it whoever is connected. The panel is part of the
            shell for the same reason the header is: it belongs to the service, not to
            whichever page the leader happens to be looking at. */}
        <div className="flex min-h-0 flex-1 print:block">
          <div className="flex min-h-0 flex-1 flex-col print:block">
            <Outlet />
          </div>
          <DevicesPanel />
        </div>
      </div>
    </HeaderSlotsProvider>
  );
}
