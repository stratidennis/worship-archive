import { Outlet } from 'react-router-dom';
import { AppHeader } from './AppHeader.js';
import { HeaderSlotsProvider } from './header-slots.js';

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
  return (
    <HeaderSlotsProvider>
      <div className="flex h-dvh flex-col print:block print:h-auto">
        <AppHeader />
        <Outlet />
      </div>
    </HeaderSlotsProvider>
  );
}
