import { useT } from '../lib/i18n.js';
import type { ConnectionStatus } from '../lib/useSession.js';

/**
 * Connected, reconnecting, or not.
 *
 * A dot and a word, never a dialog. The legacy app put a modal on screen when the
 * connection dropped — on a stage monitor, mid-song — and the single most useful thing
 * this can do is stay out of the way while the socket quietly reconnects itself.
 */
export function StatusDot({ status }: { status: ConnectionStatus }) {
  const { t } = useT();
  const colour =
    status === 'live'
      ? 'oklch(70% 0.17 150)'
      : status === 'connecting'
        ? 'oklch(78% 0.15 85)'
        : 'oklch(62% 0.21 25)';
  const label = t(
    status === 'live'
      ? 'status.live'
      : status === 'connecting'
        ? 'status.connecting'
        : 'status.offline',
  );
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs text-(--color-muted)"
      title={label}
      role="status"
    >
      <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
