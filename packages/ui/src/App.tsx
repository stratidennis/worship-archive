import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Library } from './routes/Library.js';
import { SongPage } from './routes/SongPage.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/song/:id" element={<SongPage />} />
      </Routes>
    </BrowserRouter>
  );
}
