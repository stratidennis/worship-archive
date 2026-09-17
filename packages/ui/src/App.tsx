import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Library } from './routes/Library.js';
import { SongPage } from './routes/SongPage.js';
import { EditPage } from './routes/EditPage.js';
import { SetsPage } from './routes/SetsPage.js';
import { SetEditPage } from './routes/SetEditPage.js';
import { LeadPage } from './routes/LeadPage.js';
import { BandPage } from './routes/BandPage.js';
import { StagePage } from './routes/StagePage.js';
import { JoinPage } from './routes/JoinPage.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/song/:id" element={<SongPage />} />
        <Route path="/edit/:id" element={<EditPage />} />
        <Route path="/sets" element={<SetsPage />} />
        <Route path="/sets/:id" element={<SetEditPage />} />
        <Route path="/lead" element={<LeadPage />} />
        <Route path="/band" element={<BandPage />} />
        <Route path="/stage" element={<StagePage />} />
        <Route path="/join" element={<JoinPage />} />
      </Routes>
    </BrowserRouter>
  );
}
