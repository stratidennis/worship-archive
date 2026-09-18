import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type CleanupAudit, type CleanupSuggestion } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { NavBar } from '../components/NavBar.js';

/**
 * Reviewing chord-spelling fixes — D12.
 *
 * The real library has 67 chords spelled in ways the old app tolerated. Every one of
 * them is a chord someone has read off a screen and played correctly for years, which
 * is why this screen exists at all instead of a migration that silently rewrote them.
 *
 * Grouped by spelling rather than listed as 67 rows: the decision a musician is
 * actually making is "is `Cm#` meant to be `C#m`?", once, not sixty-seven times. Each
 * group expands to show every occurrence in context, because the answer can be no —
 * and a wrong fix applied to eleven songs is much worse than eleven left alone.
 */

type Key = string;
const keyOf = (s: CleanupSuggestion): Key =>
  `${s.songId}:${s.blockId}:${s.lineIndex}:${s.layer}:${s.at}`;

export function CleanupPage() {
  const { t } = useT();
  const [audit, setAudit] = useState<CleanupAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<Key>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{
    songs: number;
    chords: number;
    stale: number;
  } | null>(null);

  useEffect(() => {
    adminApi
      .cleanup()
      .then(setAudit)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const bySpelling = useMemo(() => {
    const groups = new Map<string, CleanupSuggestion[]>();
    for (const suggestion of audit?.suggestions ?? []) {
      const list = groups.get(suggestion.raw);
      if (list) list.push(suggestion);
      else groups.set(suggestion.raw, [suggestion]);
    }
    return [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
  }, [audit]);

  const toggle = (keys: Key[], on: boolean): void =>
    setChosen((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const apply = async (): Promise<void> => {
    if (!audit) return;
    setBusy(true);
    try {
      const fixes = audit.suggestions
        .filter((s) => chosen.has(keyOf(s)))
        .map(({ songId, blockId, lineIndex, at, layer, raw, fixed }) => ({
          songId,
          blockId,
          lineIndex,
          at,
          layer,
          raw,
          fixed,
        }));
      const outcome = await adminApi.applyCleanup(fixes);
      setApplied(outcome);
      setChosen(new Set());
      setAudit(await adminApi.cleanup());
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <NavBar current="settings" back={{ to: '/settings', label: t('settings.title') }} />
      <header className="mb-4">
        <h1 className="text-2xl font-bold">{t('cleanup.title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-(--color-muted)">{t('cleanup.intro')}</p>
      </header>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {applied && (
        <p className="mb-4 rounded-lg border border-(--color-line) p-3 text-sm" role="status">
          {t('cleanup.applied', {
            chords: applied.chords,
            songs: t('cleanup.songsAffected', { count: applied.songs }),
          })}
          {applied.stale > 0 && ` ${t('cleanup.stale', { count: applied.stale })}`}
          <span className="mt-1 block text-xs text-(--color-muted)">
            {t('cleanup.undoHint')}
          </span>
        </p>
      )}

      {!audit && !error && (
        <p className="text-sm text-(--color-muted)">{t('cleanup.scanning')}</p>
      )}

      {audit && audit.suggestions.length === 0 && (
        <p className="mt-8 text-center text-sm text-(--color-muted)">{t('cleanup.nothing')}</p>
      )}

      {audit && audit.suggestions.length > 0 && (
        <>
          <p className="mb-3 text-sm text-(--color-muted)">
            {t('cleanup.summary', {
              chords: audit.suggestions.length,
              songs: t('cleanup.songsAffected', { count: audit.songsAffected }),
              scanned: audit.chordsScanned,
            })}
          </p>

          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => toggle(audit.suggestions.map(keyOf), true)}
              className="rounded-md border border-(--color-line) px-2.5 py-1.5 text-sm hover:bg-(--color-line)"
            >
              {t('cleanup.selectAll')}
            </button>
            <button
              type="button"
              onClick={() => setChosen(new Set())}
              className="rounded-md border border-(--color-line) px-2.5 py-1.5 text-sm hover:bg-(--color-line)"
            >
              {t('cleanup.selectNone')}
            </button>
          </div>

          <ul className="space-y-2">
            {bySpelling.map(([raw, group]) => {
              const keys = group.map(keyOf);
              const allChosen = keys.every((k) => chosen.has(k));
              const someChosen = !allChosen && keys.some((k) => chosen.has(k));
              const open = expanded.has(raw);
              return (
                <li key={raw} className="rounded-lg border border-(--color-line) px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allChosen}
                      ref={(node) => {
                        if (node) node.indeterminate = someChosen;
                      }}
                      onChange={(event) => toggle(keys, event.target.checked)}
                      aria-label={`${raw} → ${group[0]!.fixed}`}
                    />
                    <code className="rounded bg-(--color-line) px-1.5 py-0.5 font-mono text-sm">
                      {raw}
                    </code>
                    <span className="text-xs text-(--color-muted)">{t('cleanup.becomes')}</span>
                    <code className="rounded bg-(--color-chord) px-1.5 py-0.5 font-mono text-sm text-white">
                      {group[0]!.fixed}
                    </code>
                    <span className="text-xs text-(--color-muted)">
                      {t('cleanup.occurrences', { count: group.length })} · {group[0]!.reason}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(raw)) next.delete(raw);
                          else next.add(raw);
                          return next;
                        })
                      }
                      aria-expanded={open}
                      className="ml-auto rounded px-2 py-1 text-xs text-(--color-muted) hover:bg-(--color-line)"
                    >
                      {open ? '▾' : '▸'}
                    </button>
                  </div>

                  {open && (
                    <ul className="mt-2 space-y-1 border-t border-(--color-line) pt-2 text-xs">
                      {group.map((suggestion) => (
                        <li key={keyOf(suggestion)} className="flex items-baseline gap-2">
                          <input
                            type="checkbox"
                            checked={chosen.has(keyOf(suggestion))}
                            onChange={(event) =>
                              toggle([keyOf(suggestion)], event.target.checked)
                            }
                            aria-label={suggestion.title}
                          />
                          <Link
                            to={`/song/${encodeURIComponent(suggestion.songId)}`}
                            className="shrink-0 truncate font-medium hover:underline"
                            style={{ maxWidth: '12rem' }}
                          >
                            {suggestion.title}
                          </Link>
                          <span className="min-w-0 flex-1 truncate text-(--color-muted)">
                            {suggestion.context || '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {chosen.size > 0 && (
            <div className="fixed inset-x-0 bottom-0 border-t border-(--color-line) bg-(--color-stage-bg) px-4 py-3">
              <div className="mx-auto flex max-w-3xl items-center justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void apply()}
                  className="rounded-lg border border-(--color-chord) bg-(--color-chord) px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? t('cleanup.applying') : t('cleanup.apply', { count: chosen.size })}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
