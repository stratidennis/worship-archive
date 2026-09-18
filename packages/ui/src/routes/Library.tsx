import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, api, type Facets, type SearchHit, type SongSummary } from '../lib/api.js';
import { repo, onReachabilityChange, type Reachability } from '../lib/repo.js';
import { useT } from '../lib/i18n.js';
import { NavBar } from '../components/NavBar.js';
import { useHotkeys } from '../lib/useHotkeys.js';

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
  const key = song.performanceKey ?? song.writtenKey;
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
              written: song.writtenKey ?? '',
              performance: song.performanceKey ?? '',
            })
          : undefined
      }
    >
      {key}
      {transposed && <span className="ml-1 text-(--color-muted)">← {song.writtenKey}</span>}
    </span>
  );
}

export function Library() {
  const { t } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const collection = params.get('collection') ?? '';
  const key = params.get('key') ?? '';

  const [facets, setFacets] = useState<Facets | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reach, setReach] = useState<Reachability>('unknown');
  const [mirror, setMirror] = useState<{ songs: number; lastSync: string | null } | null>(null);
  const search = useRef<HTMLInputElement>(null);

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
    if (!collection && !key) return;
    api
      .songs({ collection: collection || undefined, key: key || undefined })
      .then(setSongs)
      .catch((e: unknown) => setError(String(e)));
  }, [collection, key]);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    if (query.trim() === '') {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      repo
        .search(query)
        .then(setHits)
        .catch((e: unknown) => setError(String(e)));
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  const createSong = (): Promise<void> =>
    adminApi
      .createSong({ title: '' })
      .then((created) => navigate(`/edit/${encodeURIComponent(created.id)}`))
      .catch((e: unknown) => setError(String(e)));

  const setParam = (name: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const results: SongSummary[] = useMemo(() => hits ?? songs, [hits, songs]);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      <NavBar current="library">
        <Link
          to="/import"
          className="rounded-lg border border-(--color-line) px-3 py-2 text-sm font-medium hover:bg-(--color-line)"
        >
          {t('app.import')}
        </Link>
        <button
          type="button"
          onClick={() => void createSong()}
          className="rounded-lg border border-(--color-chord) bg-(--color-chord) px-3 py-2 text-sm font-medium text-white"
        >
          {t('library.new')}
        </button>
      </NavBar>

      <h1 className="mb-3 text-2xl font-bold">{t('app.library')}</h1>

      <input
        ref={search}
        type="search"
        value={query}
        onChange={(e) => setParam('q', e.target.value)}
        placeholder={t('library.search')}
        aria-label={t('library.search')}
        autoComplete="off"
        className="w-full rounded-lg border border-(--color-line) bg-transparent px-4 py-3 text-base outline-none focus:border-(--color-chord)"
      />

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
          {facets.keys.slice(0, 8).map((k) => (
            <Chip
              key={k.name}
              active={key === k.name}
              onClick={() => setParam('key', key === k.name ? '' : k.name)}
            >
              {k.name}
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

      <ul id="main" className="divide-y divide-(--color-line)">
        {results.map((song) => (
          <li key={song.id}>
            <Link
              to={`/song/${encodeURIComponent(song.id)}`}
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
              <Link
                to="/import"
                className="mt-3 inline-block rounded-lg border border-(--color-chord) bg-(--color-chord) px-3 py-2 font-medium text-white"
              >
                {t('import.title')}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
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
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
  );
}
