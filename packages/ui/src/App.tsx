import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { I18nProvider, useT } from './lib/i18n.js';
import { useTheme } from './lib/theme.js';
import { Chrome } from './components/Chrome.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { LeaderSessionProvider } from './components/LeaderSession.js';
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
import { ClientSetupPage } from './routes/ClientSetupPage.js';

/**
 * The skip link.
 *
 * First thing in the tab order on every page, invisible until focused. The archive and
 * the set workspace both put a row of controls before the content, and without this a
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

/*
  A data router, not `<BrowserRouter>`.

  The editor has to be able to stop a navigation when there are unsaved changes, and
  `useBlocker` only exists on a data router.

  Everything with navigation hangs off one layout route, so there is one header for the
  life of the app rather than one per page — see `Chrome`. The performance views are
  deliberately outside it: they have no chrome at all.
*/
const router = createBrowserRouter([
  {
    element: <Chrome />,
    children: [
      // `/` is a set, because the set is the thing being worked on, and the archive is
      // where you go to find a song for it.
      { path: '/', element: <Home /> },
      { path: '/archive', element: <Library /> },
      // The archive used to be called the library; old QR codes and bookmarks still work.
      { path: '/library', element: <Navigate to="/archive" replace /> },
      { path: '/song/:id', element: <SongPage /> },
      { path: '/edit/:id', element: <EditPage /> },
      { path: '/sets', element: <SetsPage /> },
      { path: '/sets/:id', element: <SetPage /> },
      // Leading is a switch on the set, not a screen of its own. The old address still
      // exists because it is in the desktop app's menus and in people's bookmarks.
      { path: '/lead', element: <Navigate to="/" replace /> },
      { path: '/join', element: <JoinPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/cleanup', element: <CleanupPage /> },
    ],
  },
  // The installed Band and Stage apps use the same renderer, theme, controls, and
  // translations as every browser page. Only the native shell decides to start here.
  { path: '/device-setup', element: <ClientSetupPage /> },
  { path: '/band', element: <BandPage /> },
  { path: '/stage', element: <StagePage /> },
]);

export function App() {
  // Above the router, so the theme is applied on the performance views too and is not
  // re-applied on every navigation.
  useTheme();
  return (
    <I18nProvider>
      {/* Above the router: leading survives navigating, and only ends when it is
          switched off. */}
      <LeaderSessionProvider>
        <SkipLink />
        <RouterProvider router={router} />
        {/* One dialog for the whole app, so any page can ask a question by awaiting one. */}
        <ConfirmDialog />
      </LeaderSessionProvider>
    </I18nProvider>
  );
}
