import type { BrowserWindow } from 'electron';

/** Electron's names for the Back/Forward commands emitted by hardware mouse buttons. */
export function historyDirection(command: string): -1 | 0 | 1 {
  if (command === 'browser-backward') return -1;
  if (command === 'browser-forward') return 1;
  return 0;
}

/**
 * Give the installed apps the same hardware Back/Forward behaviour as a real browser.
 *
 * Windows and Linux surface mouse navigation buttons as `app-command` events instead
 * of navigating Chromium automatically. Using Electron's navigation history produces
 * the normal `popstate` event, so React Router — including its unsaved-edit blocker —
 * remains the single owner of what navigating back means.
 */
export function installHistoryCommands(target: BrowserWindow): void {
  target.on('app-command', (event, command) => {
    const direction = historyDirection(command);
    const history = target.webContents.navigationHistory;
    if (direction === -1 && history.canGoBack()) {
      event.preventDefault();
      history.goBack();
    } else if (direction === 1 && history.canGoForward()) {
      event.preventDefault();
      history.goForward();
    }
  });
}
