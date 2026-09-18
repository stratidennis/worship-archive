import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider, useT } from './lib/i18n.js';
import { useTheme } from './lib/theme.js';
import { Library } from './routes/Library.js';
import { SongPage } from './routes/SongPage.js';
import { EditPage } from './routes/EditPage.js';
import { SetsPage } from './routes/SetsPage.js';
import { SetPage } from './routes/SetPage.js';
import { Home } from './routes/Home.js';
import { LeadPage } from './routes/LeadPage.js';
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

function Shell() {
  useTheme();
  return (
    <>
      <SkipLink />
      <Routes>
        {/*
          `/` is a set, not the library. The set is the thing being worked on; the
          library is where you go to find a song for it.
        */}
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        <Route path="/song/:id" element={<SongPage />} />
        <Route path="/edit/:id" element={<EditPage />} />
        <Route path="/sets" element={<SetsPage />} />
        <Route path="/sets/:id" element={<SetPage />} />
        <Route path="/lead" element={<LeadPage />} />
        <Route path="/band" element={<BandPage />} />
        <Route path="/stage" element={<StagePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/cleanup" element={<CleanupPage />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </I18nProvider>
  );
}
