import { useT, type TranslationKey } from '../lib/i18n.js';

/**
 * The shortcut list, shown by `?`.
 *
 * Worth having as a real surface rather than a line in a README: a leader learns these
 * during a service, and the moment they want to know is the moment they cannot go and
 * look them up.
 */
export function Shortcuts({
  rows,
  onClose,
}: {
  rows: { keys: string; label: TranslationKey }[];
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('keys.title')}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-(--color-line) bg-(--color-stage-bg) p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">{t('keys.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-(--color-muted) hover:bg-(--color-line)"
          >
            {t('app.close')}
          </button>
        </div>
        <dl className="space-y-1.5 text-sm">
          {rows.map((row) => (
            <div key={row.keys} className="flex items-baseline justify-between gap-4">
              <dt className="text-(--color-muted)">{t(row.label)}</dt>
              <dd className="shrink-0">
                {row.keys.split(' ').map((key) => (
                  <kbd
                    key={key}
                    className="ml-1 rounded border border-(--color-line) bg-(--color-line)/60 px-1.5 py-0.5 font-mono text-xs"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
