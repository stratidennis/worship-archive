import type { Translator } from './i18n.js';

/**
 * What to call a set.
 *
 * The date, because that is what a service is: people say "last Sunday", not "Program
 * nou". A stored title is only used for sets made before the date became the name, and
 * for the rare one with no date at all — otherwise the two could disagree, and for a
 * while they did.
 */
export function setName(
  set: { title: string; date: string | null },
  format: Translator['date'],
): string {
  if (set.date) return format(set.date);
  return set.title.trim() || format(null);
}
