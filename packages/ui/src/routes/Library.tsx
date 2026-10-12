import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { canonicalFilterKey, compareFilterKeys, preferredKeyName } from '@worship/core';
import { api, type Facets, type SearchHit, type SongSummary } from '../lib/api.js';
import { repo, onReachabilityChange, type Reachability } from '../lib/repo.js';
import { useT } from '../lib/i18n.js';
import { Scroll } from '../components/Scroll.js';
import { HeaderActions, useHeader } from '../components/header-slots.js';
import { IconPlus, IconSearch } from '../components/icons.js';
import { Button, ButtonLink, Input } from '../components/ui.js';
import { useHotkeys } from '../lib/useHotkeys.js';
import { usePrefs } from '../lib/settings.js';
import { filterArchiveSongs, toggleArchiveKey } from '../lib/archiveFilter.js';
import {
  archiveFiltersFromParams,
  readArchiveState,
  rememberArchiveState,
} from '../lib/archiveState.js';
import { useArchiveScroll } from '../lib/useArchiveScroll.js';

/** Render an FTS5 snippet, which marks matches with «». */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span className="text-(--color-muted)">
      {parts.map((part, i) =>
        part.startsWith('«') ? (
          <mark key={i} className="bg-transparent font-semibold text-(--color-chord)">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

function KeyBadge({ song }: { song: SongSummary }) {
  const { t } = useT();
  const [prefs] = usePrefs();
  const key = preferredKeyName(
    song.performanceKey ?? song.writtenKey,
    prefs.accidentalPreferences,
  );
  if (!key) return null;
  const transposed =
    song.performanceKey && song.writtenKey && song.performanceKey !== song.writtenKey;
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums"
      style={{ background: 'var(--color-line)' }}
      title={
        transposed
          ? t('library.writtenPlayed', {
              written: preferredKeyName(song.writtenKey, prefs.accidentalPreferences) ?? '',
              performance:
                preferredKeyName(song.performanceKey, prefs.accidentalPreferences) ?? '',
            })
          : undefined
      }
    >
      {key}
      {transposed && (
        <span className="ml-1 text-(--color-muted)">
          ← {preferredKeyName(song.writtenKey, prefs.accidentalPreferences)}
        </span>
      )}
    </span>
  );
}

export function Library() {
  const { t } = useT();
  const [prefs] = usePrefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [initialParams] = useState(() =>
    location.search ? new URLSearchParams(location.search) : readArchiveState('library'),
  );
  const [params, setParams] = useSearchParams(initialParams);
  useEffect(() => rememberArchiveState('library', params), [params]);
  const query = params.get('q') ?? '';
  const collection = params.get('collection') ?? '';
  const { keys } = useMemo(() => archiveFiltersFromParams(params), [params]);
  const [inCollection, setInCollection] = useState<Set<string> | null>(null);

  const [facets, setFacets] = useState<Facets | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reach, setReach] = useState<Reachability>('unknown');
  const [mirror, setMirror] = useState<{ songs: number; lastSync: string | null } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const [songsReady, setSongsReady] = useState(false);
  const [searchReady, setSearchReady] = useState(false);
  const archiveScroll = useArchiveScroll<HTMLDivElement>(
    'library:' + params.toString(),
    songsReady && (!query.trim() || searchReady) && (!collection || inCollection !== null),
  );

  useHeader({ current: 'library' });

  useEffect(() => onReachabilityChange(setReach), []);

  // `/` is the search shortcut everywhere on the web, and a leader hunting for a song
  // between two others has both hands free for exactly as long as that takes.
  useHotkeys({
    '/': () => search.current?.focus(),
    n: () => void createSong(),
  });

  // Mirror first, then refresh from the host. The list therefore appears instantly and
  // identically whether or not there is a host to reach.
  useEffect(() => {
    let cancelled = false;
    const show = async (): Promise<void> => {
      const local = await repo.songs();
      if (!cancelled && local.length > 0) setSongs(local);
      const synced = await repo.sync();
      if (cancelled) return;
      if (synced) setSongs(await repo.songs());
      setMirror(await repo.status());
      setSongsReady(true);
    };
    void show();
    return () => {
      cancelled = true;
    };
  }, []);

  // Facets come from the host's index; offline the filters simply do not appear.
  useEffect(() => {
    api
      .facets()
      .then(setFacets)
      .catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!collection) {
      setInCollection(null);
      return;
    }
    setInCollection(null);
    void api
      .songs({ collection })
      .then((next) => !cancelled && setInCollection(new Set(next.map((song) => song.id))))
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [collection]);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    if (query.trim() === '') {
      setHits(null);
      return;
    }
    let cancelled = false;
    setSearchReady(false);
    const timer = setTimeout(() => {
      repo
        .search(query)
        .then((next) => !cancelled && setHits(next))
        .catch((e: unknown) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setSearchReady(true));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const createSong = (): void => {
    // EditPage owns the local draft. No empty file is written until Save succeeds.
    navigate('/edit/new', {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  };

  const setParam = (name: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const toggleKey = (key: string): void => {
    const next = new URLSearchParams(params);
    next.delete('key');
    for (const selected of toggleArchiveKey(keys, key)) next.append('key', selected);
    setParams(next, { replace: true });
  };

  const results = useMemo(
    () => filterArchiveSongs(hits ?? songs, { collection, keys }, inCollection),
    [hits, songs, collection, keys, inCollection],
  );
  const keyFacets = useMemo(() => {
    const merged = new Map<string, number>();
    for (const item of facets?.keys ?? []) {
      const name = canonicalFilterKey(item.name);
      if (name) merged.set(name, (merged.get(name) ?? 0) + item.count);
    }
    return [...merged]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => compareFilterKeys(a.name, b.name));
  }, [facets]);

  return (
    <>
      <HeaderActions>
        <ButtonLink to="/import">{t('app.import')}</ButtonLink>
        <Button variant="primary" onClick={createSong}>
          <IconPlus size={16} />
          <span className="hidden sm:inline">{t('library.new')}</span>
        </Button>
      </HeaderActions>
      <Scroll {...archiveScroll}>
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-8">
          {/* Every page carries one, so a screen reader announces where it landed. */}
          <h1 className="mb-3 text-2xl font-bold">{t('app.library')}</h1>
          <div className="relative">
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-muted)"
            />
            <Input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder={t('library.search')}
              aria-label={t('library.search')}
              autoComplete="off"
              className="h-11 pl-9 text-base"
            />
          </div>

          {facets && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
              <Chip active={!collection} onClick={() => setParam('collection', '')}>
                {t('library.all')} ({facets.collections.reduce((n, c) => n + c.count, 0)})
              </Chip>
              {facets.collections.map((c) => (
                <Chip
                  key={c.name}
                  active={collection === c.name}
                  onClick={() => setParam('collection', collection === c.name ? '' : c.name)}
                >
                  {c.name} ({c.count})
                </Chip>
              ))}
              <span className="mx-1 w-px bg-(--color-line)" />
              {keyFacets.map((k) => (
                <Chip
                  key={k.name}
                  active={keys.includes(k.name)}
                  onClick={() => toggleKey(k.name)}
                >
                  {preferredKeyName(k.name, prefs.accidentalPreferences) ?? k.name}
                </Chip>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-6 rounded-md border border-(--color-line) p-3 text-sm text-(--color-muted)">
              {t('library.loadError', { error })}
            </p>
          )}

          <p
            className="mt-5 mb-2 flex items-center gap-2 text-xs text-(--color-muted)"
            role="status"
          >
            <span>
              {t('library.count', { count: results.length })}
              {hits && ` ${t('library.found')}`}
            </span>
            {reach === 'offline' && mirror && (
              <span className="rounded-full bg-(--color-line) px-2 py-0.5">
                {t('library.offlineBadge', { count: mirror.songs })}
              </span>
            )}
          </p>

          <ul id="main" className="grid gap-x-6 lg:grid-cols-2">
            {results.map((song) => (
              <li key={song.id} className="border-b border-(--color-line)">
                <Link
                  to={`/song/${encodeURIComponent(song.id)}`}
                  state={{ returnTo: `${location.pathname}${location.search}` }}
                  className="flex items-baseline gap-3 py-2.5 hover:bg-(--color-line)/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {song.title || t('app.untitled')}
                    </span>
                    {hits && 'snippet' in song && (
                      <span className="block truncate text-xs">
                        <Snippet text={(song as SearchHit).snippet} />
                      </span>
                    )}
                  </span>
                  {song.tempo && (
                    <span className="shrink-0 text-xs tabular-nums text-(--color-muted)">
                      {song.tempo}
                    </span>
                  )}
                  <KeyBadge song={song} />
                </Link>
              </li>
            ))}
          </ul>

          {results.length === 0 && !error && (
            <div className="mt-10 text-center text-sm text-(--color-muted)">
              {query ? (
                <p>{t('library.nothingFor', { query })}</p>
              ) : (
                <>
                  <p>{t('library.empty')}</p>
                  <p className="mt-1">{t('library.emptyHint')}</p>
                  <ButtonLink to="/import" variant="primary" className="mt-3">
                    {t('import.title')}
                  </ButtonLink>
                </>
              )}
            </div>
          )}
        </div>
      </Scroll>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) bg-(--color-surface) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
  );
}
