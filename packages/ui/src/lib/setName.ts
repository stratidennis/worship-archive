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

/**
 * The next Sunday, as an ISO date — the default for a new service.
 *
 * Today never counts, even on a Sunday: a set created during a service is the one being
 * planned for next week, not a second copy of the one currently running.
 */
export function nextSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
