import { answerConfirm, usePendingConfirm } from '../lib/confirm.js';
import { useT } from '../lib/i18n.js';
import { Modal } from './Modal.js';
import { Button } from './ui.js';

/** Mounted once at the root; shows whatever `confirmAction` is currently asking. */
export function ConfirmDialog() {
  const { t } = useT();
  const pending = usePendingConfirm();
  if (!pending) return null;

  return (
    <Modal
      title={pending.message}
      detail={pending.detail}
      tone={pending.danger ? 'danger' : 'warn'}
      onDismiss={() => answerConfirm(false)}
    >
      {/* Cancel first: it takes the focus, so Enter can never confirm a deletion. */}
      <Button onClick={() => answerConfirm(false)}>{t('app.cancel')}</Button>
      <Button
        variant={pending.danger ? 'danger' : 'primary'}
        onClick={() => answerConfirm(true)}
      >
        {pending.confirmLabel ?? t('app.delete')}
      </Button>
    </Modal>
  );
}
