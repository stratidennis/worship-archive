import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Facets, type SearchHit, type SongSummary } from '../lib/api.js';

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
  const key = song.performanceKey ?? song.writtenKey;
  if (!key) return null;
  const transposed = song.performanceKey && song.writtenKey && song.performanceKey !== song.writtenKey;
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums"
      style={{ background: 'var(--color-line)' }}
      title={transposed ? `written in ${song.writtenKey}, played in ${song.performanceKey}` : undefined}
    >
      {key}
      {transposed && <span className="ml-1 text-(--color-muted)">← {song.writtenKey}</span>}
    </span>
  );
}

export function Library() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const collection = params.get('collection') ?? '';
  const key = params.get('key') ?? '';

  const [facets, setFacets] = useState<Facets | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.facets().then(setFacets).catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
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
      api.search(query).then(setHits).catch((e: unknown) => setError(String(e)));
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  const setParam = (name: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const results: SongSummary[] = useMemo(() => hits ?? songs, [hits, songs]);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-(--color-muted)">Worship Archive</p>
          <h1 className="text-2xl font-bold">Biblioteca</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        <Link
          to="/lead"
          className="rounded-lg border border-(--color-line) px-3 py-2 text-sm font-medium hover:bg-(--color-line)"
        >
          Condu
        </Link>
        <Link
          to="/band"
          className="rounded-lg border border-(--color-line) px-3 py-2 text-sm font-medium hover:bg-(--color-line)"
        >
          Trupă
        </Link>
        <Link
          to="/sets"
          className="rounded-lg border border-(--color-line) px-3 py-2 text-sm font-medium hover:bg-(--color-line)"
        >
          Programe
        </Link>
        <button
          type="button"
          onClick={() => {
            void fetch('/api/songs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title: '' }),
            })
              .then((r) => r.json() as Promise<SongSummary>)
              .then((created) => navigate(`/edit/${encodeURIComponent(created.id)}`))
              .catch((e: unknown) => setError(String(e)));
          }}
          className="shrink-0 rounded-lg border border-(--color-chord) bg-(--color-chord) px-3 py-2 text-sm font-medium text-white"
        >
          + Cântare nouă
        </button>
        </div>
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setParam('q', e.target.value)}
        placeholder="Caută titlu sau versuri…"
        autoComplete="off"
        className="w-full rounded-lg border border-(--color-line) bg-transparent px-4 py-3 text-base outline-none focus:border-(--color-chord)"
      />

      {facets && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
          <Chip active={!collection} onClick={() => setParam('collection', '')}>
            Toate ({facets.collections.reduce((n, c) => n + c.count, 0)})
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
          Nu pot încărca biblioteca: {error}
        </p>
      )}

      <p className="mt-5 mb-2 text-xs text-(--color-muted)">
        {results.length} {results.length === 1 ? 'cântare' : 'cântări'}
        {hits && ' găsite'}
      </p>

      <ul className="divide-y divide-(--color-line)">
        {results.map((song) => (
          <li key={song.id}>
            <Link
              to={`/song/${encodeURIComponent(song.id)}`}
              className="flex items-baseline gap-3 py-2.5 hover:bg-(--color-line)/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{song.title || '(fără titlu)'}</span>
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
        <p className="mt-8 text-center text-sm text-(--color-muted)">
          {query ? `Nimic pentru „${query}”` : 'Biblioteca este goală.'}
        </p>
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
