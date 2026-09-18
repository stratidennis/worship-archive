import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { IconAlert, IconCheck, IconSpinner } from './icons.js';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Whether the work is safe.
 *
 * It used to read "salvat" and then go on reading it, which is the least useful thing a
 * status can do: a word that is always there stops being read, and the one moment it
 * matters — when it says something else — you have already learned to look past it. So
 * it appears, says its piece, and goes.
 *
 * A spinner while it is in flight, a tick in the success colour when it lands, and
 * three seconds later nothing. Errors stay: they are the one state nobody should be
 * able to miss, and the only one that needs a decision.
 *
 * `quietWhenDirty` is for a page that saves itself. There, "unsaved" is true for the
 * 700ms of the debounce and then stops being true, and flashing it is noise about a
 * problem that does not exist. Where saving is a button you press, it stays.
 */
export function SaveBadge({
  state,
  quietWhenDirty = false,
}: {
  state: SaveState;
  quietWhenDirty?: boolean;
}) {
  const { t } = useT();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (state !== 'saved') {
      setSettled(false);
      return;
    }
    setSettled(true);
    const timer = setTimeout(() => setSettled(false), 3000);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'error') {
    return (
      <span
        className="fade-in flex shrink-0 items-center gap-1.5 text-xs text-red-500"
        role="status"
      >
        <IconAlert size={14} />
        <span className="hidden sm:inline">{t('save.error')}</span>
      </span>
    );
  }

  if (state === 'saving') {
    return (
      <span
        className="fade-in flex shrink-0 items-center gap-1.5 text-xs text-(--color-muted)"
        role="status"
      >
        <IconSpinner size={14} className="animate-spin" />
        <span className="hidden sm:inline">{t('save.saving')}</span>
      </span>
    );
  }

  if (state === 'saved' && settled) {
    return (
      <span
        className="fade-in flex shrink-0 items-center gap-1.5 text-xs text-(--color-ok)"
        role="status"
      >
        <IconCheck size={14} />
        <span className="hidden sm:inline">{t('save.saved')}</span>
      </span>
    );
  }

  if (state === 'dirty' && !quietWhenDirty) {
    return (
      <span
        className="flex shrink-0 items-center gap-1.5 text-xs text-(--color-muted)"
        role="status"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-(--color-cue)" />
        <span className="hidden sm:inline">{t('save.dirty')}</span>
      </span>
    );
  }

  return null;
}
