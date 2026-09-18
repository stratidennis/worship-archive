import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts.
 *
 * The leader's hands are on an instrument, so the keyboard is not a convenience here —
 * during a service it is the primary interface. Two rules follow from that:
 *
 *  - **Never fire while someone is typing.** A leader renaming a set and pressing `b`
 *    must get the letter b, not a black screen in front of the congregation.
 *  - **Handlers are read from a ref.** A `keydown` listener that is torn down and
 *    re-added on every render drops keypresses that arrive mid-render, which shows up
 *    as a shortcut that works four times out of five and is miserable to diagnose.
 */

export type Hotkeys = Record<string, (event: KeyboardEvent) => void>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Normalise an event into a lookup key: `ArrowRight`, `b`, `?`, `mod+z`, `shift+mod+z`.
 *
 * `mod` is Cmd on macOS and Ctrl elsewhere, which is what every user of either expects
 * without being told.
 */
export function hotkeyOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.shiftKey && event.key.length > 1) parts.push('shift');
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join('+');
}

export function useHotkeys(keys: Hotkeys, enabled = true): void {
  const latest = useRef(keys);
  latest.current = keys;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      // `mod+z` is undo everywhere, including inside this app's own editors, so it is
      // allowed through even when the modifier would otherwise mean a browser shortcut.
      const handler = latest.current[hotkeyOf(event)];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
