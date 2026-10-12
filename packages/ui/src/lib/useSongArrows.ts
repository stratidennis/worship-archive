import { useHotkeys } from './useHotkeys.js';

/** Leave arrow keys to text fields (useHotkeys) and open dialogs. */
export function useSongArrows(step: (direction: 1 | -1) => void): void {
  const move = (direction: 1 | -1): void => {
    if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return;
    step(direction);
  };
  useHotkeys({
    ArrowRight: () => move(1),
    ArrowDown: () => move(1),
    ArrowLeft: () => move(-1),
    ArrowUp: () => move(-1),
  });
}
