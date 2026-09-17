import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Library } from './routes/Library.js';
import { SongPage } from './routes/SongPage.js';
import { EditPage } from './routes/EditPage.js';
import { SetsPage } from './routes/SetsPage.js';
import { SetEditPage } from './routes/SetEditPage.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/song/:id" element={<SongPage />} />
        <Route path="/edit/:id" element={<EditPage />} />
        <Route path="/sets" element={<SetsPage />} />
        <Route path="/sets/:id" element={<SetEditPage />} />
      </Routes>
    </BrowserRouter>
  );
}
