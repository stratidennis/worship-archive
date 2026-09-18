import { useOverlay } from './Modal.js';
import { IconButton } from './ui.js';
import { IconClose } from './icons.js';

/**
 * A panel of controls over the page, for a screen with nowhere to send you.
 *
 * `Modal` is for a question — a mark, a sentence, and buttons. This is for the other
 * shape: a title and some things to adjust, with one way out. They share the keyboard
 * behaviour, which is the part that matters and the part that rots when it is copied.
 *
 * It exists because the band view has no navigation on purpose. A musician following
 * the leader should not be one stray tap from a settings page, and going to one would
 * end their session — so the few settings that matter on a phone in a dark room come
 * to them instead.
 */
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const panel = useOverlay(onClose);

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-panel max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-(--color-line) bg-(--color-surface) p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
          <IconButton variant="ghost" label={title} onClick={onClose}>
            <IconClose size={17} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
