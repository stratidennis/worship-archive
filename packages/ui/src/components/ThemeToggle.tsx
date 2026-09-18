import { usePrefs } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { IconMoon, IconSun } from './icons.js';

/**
 * One button: light or dark, right now.
 *
 * Not a four-way control. `auto` and `stage` still exist and still live in Settings,
 * but the thing anyone wants in a header is to flip the lights — usually because the
 * room changed, halfway through setting up. Pressing this is an explicit choice, so it
 * leaves `auto` behind, which is the honest behaviour: the button would otherwise
 * appear to do nothing when the system disagreed with it.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useT();
  const [prefs, setPrefs] = usePrefs();

  const systemDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const dark =
    prefs.theme === 'dark' || prefs.theme === 'stage' || (prefs.theme === 'auto' && systemDark);
  const label = dark ? t('nav.themeToLight') : t('nav.themeToDark');

  return (
    <button
      type="button"
      onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-lg border border-(--color-line) bg-(--color-surface) transition-colors hover:bg-(--color-line) ${className}`}
    >
      {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
    </button>
  );
}
