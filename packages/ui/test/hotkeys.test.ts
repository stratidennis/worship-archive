import { describe, expect, it } from 'vitest';
import { hotkeyOf } from '../src/lib/useHotkeys.js';

/** A minimal stand-in: only the four fields `hotkeyOf` reads. */
function event(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...init,
  } as KeyboardEvent;
}

describe('naming a keypress', () => {
  it('lowercases letters, so Caps Lock does not silently break every shortcut', () => {
    expect(hotkeyOf(event({ key: 'B' }))).toBe('b');
    expect(hotkeyOf(event({ key: 'b' }))).toBe('b');
  });

  it('keeps named keys as they are', () => {
    expect(hotkeyOf(event({ key: 'ArrowRight' }))).toBe('ArrowRight');
    expect(hotkeyOf(event({ key: 'Escape' }))).toBe('Escape');
    expect(hotkeyOf(event({ key: ' ' }))).toBe(' ');
  });

  it('treats Cmd and Ctrl as the same modifier', () => {
    // Nobody should have to learn which one this app wants.
    expect(hotkeyOf(event({ key: 'z', metaKey: true }))).toBe('mod+z');
    expect(hotkeyOf(event({ key: 'z', ctrlKey: true }))).toBe('mod+z');
  });

  it('ignores Shift for printable keys, because the key already reflects it', () => {
    // Shift+/ arrives as `?`; naming it `shift+?` would mean no handler ever matched.
    expect(hotkeyOf(event({ key: '?', shiftKey: true }))).toBe('?');
    expect(hotkeyOf(event({ key: '+', shiftKey: true }))).toBe('+');
  });

  it('keeps Shift for named keys, where it does change the meaning', () => {
    expect(hotkeyOf(event({ key: 'Tab', shiftKey: true }))).toBe('shift+Tab');
  });

  it('orders modifiers consistently', () => {
    expect(hotkeyOf(event({ key: 'ArrowUp', shiftKey: true, metaKey: true }))).toBe(
      'shift+mod+ArrowUp',
    );
  });
});
