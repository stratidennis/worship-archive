import { useT } from '../lib/i18n.js';
import { setLeading, useLeading } from '../lib/leading.js';
import { useLeaderSession } from './LeaderSession.js';
import { IconButton, ButtonLink } from './ui.js';
import { IconClose } from './icons.js';

/**
 * Who is connected — opened and closed from the header, like a chat sidebar.
 *
 * Rendered by the shell rather than by the set page, so it survives navigating: a
 * leader who opens the QR screen to get one more phone on comes back to the panel
 * still open, which is the only way to watch that phone actually arrive.
 *
 * Hidden on a phone. The leader's own device is a laptop, and a 208px column beside a
 * 375px screen would leave no room for the thing it is beside.
 */
export function DevicesPanel() {
  const { t } = useT();
  const { setId, devicesOpen } = useLeading();
  const { devices, deviceId } = useLeaderSession();
  if (setId === null || !devicesOpen) return null;

  return (
    <aside
      aria-label={t('lead.connected', { count: devices.length })}
      className="scroll-slim hidden w-52 shrink-0 flex-col overflow-y-auto border-l border-(--color-line) bg-(--color-surface) px-3 py-2 print:hidden sm:flex"
    >
      <div className="mb-2 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs uppercase tracking-wider text-(--color-muted)">
          {t('lead.connected', { count: devices.length })}
        </p>
        <IconButton
          size="sm"
          label={t('app.close')}
          variant="ghost"
          onClick={() => setLeading({ devicesOpen: false })}
        >
          <IconClose size={14} />
        </IconButton>
      </div>
      <ul className="space-y-1 text-sm">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            name={device.name}
            role={device.role}
            you={device.deviceId !== null && device.deviceId === deviceId}
          />
        ))}
      </ul>
      <ButtonLink to="/join" size="sm" className="mt-3 w-full">
        {t('lead.qr')}
      </ButtonLink>
    </aside>
  );
}

/**
 * One connected device.
 *
 * The role is a tag beside the name, except where it *is* the name: a screen that was
 * never given one of its own has nothing better to be called than "Screen", and
 * "Screen — Screen" is a row that says one thing twice.
 *
 * This laptop is in the list too, and saying so matters: without it the leader counts
 * the phones in the room, gets one more than there are people, and goes looking for a
 * device that is the one they are holding.
 */
function DeviceRow({ name, role, you }: { name: string; role: string; you: boolean }) {
  const { t } = useT();
  const roleLabel =
    role === 'stage'
      ? t('lead.roleStage')
      : role === 'leader'
        ? t('lead.roleLeader')
        : t('lead.roleBand');
  const shown = name.trim() || roleLabel;
  const tag = you ? t('lead.thisDevice') : shown === roleLabel ? null : roleLabel;
  return (
    <li className="flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: 'var(--color-ok)' }}
      />
      <span className="min-w-0 flex-1 truncate">{shown}</span>
      {tag && <span className="shrink-0 text-[0.7rem] text-(--color-muted)">{tag}</span>}
    </li>
  );
}
