import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SetSummary } from '../lib/api.js';
import { api } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { forgetSet, rememberSet } from '../lib/lastSet.js';
import { confirmAction } from '../lib/desktop.js';
import { useT } from '../lib/i18n.js';
import { nextSunday, setName } from '../lib/setName.js';
import { AppHeader } from '../components/AppHeader.js';
import { Page, Scroll } from '../components/Page.js';
import { IconPlus, IconTrash } from '../components/icons.js';
import { Button, IconButton } from '../components/ui.js';

export function SetsPage() {
  const { t, date } = useT();
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
      .createSet({ title: nextSunday(), date: nextSunday() })
      .then((created) => {
        rememberSet(created.id);
        navigate(`/sets/${encodeURIComponent(created.id)}`);
      })
      .catch((e: unknown) => setError(String(e)));
  };

  return (
    <Page>
      <AppHeader current="sets">
        <Button variant="primary" onClick={create}>
          <IconPlus size={16} />
          <span className="hidden sm:inline">{t('sets.new')}</span>
        </Button>
      </AppHeader>
      <Scroll>
        <div className="mx-auto max-w-3xl px-4 pb-16 pt-5">
          <h1 className="mb-4 text-2xl font-bold">{t('app.sets')}</h1>

          {error && <p className="mb-4 text-sm text-(--color-muted)">{error}</p>}

          <ul id="main" className="divide-y divide-(--color-line)">
            {sets.map((set) => (
              <li key={set.id} className="flex items-center gap-3 py-3">
                <Link to={`/sets/${encodeURIComponent(set.id)}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{setName(set, date)}</span>
                  <span className="block text-xs text-(--color-muted)">
                    {/* The name is already the date; repeating it here said nothing. */}
                    {t('library.count', { count: set.songCount })}
                  </span>
                </Link>
                <Button
                  size="sm"
                  onClick={() => {
                    void api
                      .duplicateSet(set.id, { date: nextSunday() })
                      .then((copy) => {
                        rememberSet(copy.id);
                        navigate(`/sets/${encodeURIComponent(copy.id)}`);
                      })
                      .catch((e: unknown) => setError(String(e)));
                  }}
                  title={t('sets.duplicateHint')}
                  className="shrink-0"
                >
                  {t('sets.duplicate')}
                </Button>
                <IconButton
                  size="sm"
                  variant="danger"
                  label={t('app.delete')}
                  className="shrink-0"
                  onClick={() => {
                    void confirmAction({
                      message: t('sets.deleteConfirm', { title: setName(set, date) }),
                      confirmLabel: t('app.delete'),
                    }).then((ok) => {
                      if (!ok) return;
                      // Forget it first: this device must not reopen a set that is gone.
                      forgetSet(set.id);
                      void api
                        .deleteSet(set.id)
                        .then(load)
                        .catch((e: unknown) => setError(String(e)));
                    });
                  }}
                >
                  <IconTrash size={14} />
                </IconButton>
              </li>
            ))}
          </ul>

          {sets.length === 0 && !error && (
            <p className="mt-10 text-center text-sm text-(--color-muted)">{t('sets.empty')}</p>
          )}
        </div>
      </Scroll>
    </Page>
  );
}
