import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

/**
 * Phones use the PWA cache; installed Electron apps use their bundled files.
 *
 * Keeping those two cases separate prevents an old service worker from mixing UI and
 * server versions after a desktop upgrade. The preload bridges exist before this
 * module runs, so this test is deterministic rather than user-agent sniffing.
 */
if (!window.worship && !window.worshipClient && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => registration.update())
      .catch(() => undefined);
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
