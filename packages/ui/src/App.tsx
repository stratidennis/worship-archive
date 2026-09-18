import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { I18nProvider, useT } from './lib/i18n.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { useTheme } from './lib/theme.js';
import { Library } from './routes/Library.js';
import { SongPage } from './routes/SongPage.js';
import { EditPage } from './routes/EditPage.js';
import { SetsPage } from './routes/SetsPage.js';
import { SetPage } from './routes/SetPage.js';
import { Home } from './routes/Home.js';
import { BandPage } from './routes/BandPage.js';
import { StagePage } from './routes/StagePage.js';
import { JoinPage } from './routes/JoinPage.js';
import { ImportPage } from './routes/ImportPage.js';
import { SettingsPage } from './routes/SettingsPage.js';
import { CleanupPage } from './routes/CleanupPage.js';

/**
 * The skip link.
 *
 * First thing in the tab order on every page, invisible until focused. The library and
 * the leader console both put a row of controls before the content, and without this a
 * keyboard user tabs through all of them to reach the song.
 */
function SkipLink() {
  const { t } = useT();
  return (
    <a href="#main" className="skip-link">
      {t('app.skipToContent')}
    </a>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  useTheme();
  return (
    <>
      <SkipLink />
      {children}
      {/* One dialog for the whole app, so any page can ask a question by awaiting one. */}
      <ConfirmDialog />
    </>
  );
}

const page = (element: React.ReactNode): React.ReactElement => <Shell>{element}</Shell>;

/*
  A data router, not `<BrowserRouter>`.

  The editor has to be able to stop a navigation when there are unsaved changes, and
  `useBlocker` only exists on a data router. Everything else about the routes is
  unchanged: `/` is a set, because the set is the thing being worked on, and the library
  is where you go to find a song for it.
*/
const router = createBrowserRouter([
  { path: '/', element: page(<Home />) },
  { path: '/library', element: page(<Library />) },
  { path: '/song/:id', element: page(<SongPage />) },
  { path: '/edit/:id', element: page(<EditPage />) },
  { path: '/sets', element: page(<SetsPage />) },
  { path: '/sets/:id', element: page(<SetPage />) },
  // Leading is a switch on the set, not a screen of its own. The old address still
  // exists because it is in the desktop app's menus and in people's bookmarks.
  { path: '/lead', element: <Navigate to="/" replace /> },
  { path: '/band', element: page(<BandPage />) },
  { path: '/stage', element: page(<StagePage />) },
  { path: '/join', element: page(<JoinPage />) },
  { path: '/import', element: page(<ImportPage />) },
  { path: '/settings', element: page(<SettingsPage />) },
  { path: '/cleanup', element: page(<CleanupPage />) },
]);

export function App() {
  return (
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  );
}
