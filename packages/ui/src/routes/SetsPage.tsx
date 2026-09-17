import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SetSummary } from '../lib/api.js';
import { api } from '../lib/api.js';
import { repo } from '../lib/repo.js';

/** The next Sunday, as an ISO date — the default for a new service. */
function nextSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string | null): string {
  if (!iso) return 'fără dată';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('ro-RO', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function SetsPage() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api
      .sets()
      .then(setSets)
      .catch(() => {
        // Offline: list what the mirror holds instead of showing nothing.
        void repo.sets().then((local) =>
          setSets(
            local.map((s) => ({
              id: s.id,
              title: s.title,
              date: s.date,
              itemCount: s.items.length,
              songCount: s.items.filter((i) => i.kind === 'song').length,
              updatedAt: s.updatedAt,
            })),
          ),
        );
      });
  };
  useEffect(load, []);

  const create = (): void => {
    void api
      .createSet({ title: 'Program nou', date: nextSunday() })
      .then((created) => navigate(`/sets/${encodeURIComponent(created.id)}`))
      .catch((e: unknown) => setError(String(e)));
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <Link to="/" className="text-xs uppercase tracking-widest text-(--color-muted)">
            Worship Archive
          </Link>
          <h1 className="text-2xl font-bold">Programe</h1>
        </div>
        <button
          type="button"
          onClick={create}
          className="shrink-0 rounded-lg border border-(--color-chord) bg-(--color-chord) px-3 py-2 text-sm font-medium text-white"
        >
          + Program nou
        </button>
      </header>

      {error && <p className="mb-4 text-sm text-(--color-muted)">{error}</p>}

      <ul className="divide-y divide-(--color-line)">
        {sets.map((set) => (
          <li key={set.id} className="flex items-center gap-3 py-3">
            <Link to={`/sets/${encodeURIComponent(set.id)}`} className="min-w-0 flex-1">
              <span className="block truncate font-medium">{set.title}</span>
              <span className="block text-xs text-(--color-muted)">
                {formatDate(set.date)} · {set.songCount}{' '}
                {set.songCount === 1 ? 'cântare' : 'cântări'}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => {
                void api
                  .duplicateSet(set.id, { date: nextSunday() })
                  .then((copy) => navigate(`/sets/${encodeURIComponent(copy.id)}`))
                  .catch((e: unknown) => setError(String(e)));
              }}
              className="shrink-0 rounded-md border border-(--color-line) px-2 py-1 text-xs hover:bg-(--color-line)"
              title="Pornește de la acest program"
            >
              Duplică
            </button>
          </li>
        ))}
      </ul>

      {sets.length === 0 && !error && (
        <p className="mt-10 text-center text-sm text-(--color-muted)">
          Niciun program încă. Creează unul pentru duminica viitoare.
        </p>
      )}
    </div>
  );
}
