import { useEffect, useRef } from 'react';
import { IconAlert, IconTrash } from './icons.js';

/**
 * A dialog that has to be answered.
 *
 * One component for every question the app asks, because they were not consistent and
 * one of them was not even ours: deleting a song went through the browser's own
 * `confirm()`, which draws a grey box at the top of the window with the origin in it,
 * ignores the app's theme entirely, and blocks the whole page while it is open.
 *
 * Three things a dialog has to get right, all of which `confirm()` also gets right and
 * a hand-rolled `<div>` usually does not:
 *
 *  - **Escape answers no.** Captured, so the page's own shortcuts cannot see the key
 *    first and do something else with it while a dialog is open.
 *  - **Focus starts on the safe choice.** The first button rendered, which is why every
 *    caller puts the cancel first. Nobody should be able to delete a song by opening
 *    this and pressing Enter.
 *  - **Focus goes back where it came from.** Otherwise answering the question drops a
 *    keyboard user at the top of the document.
 */

/** What kind of answer is being asked for, which decides the mark beside the question. */
export type Tone = 'warn' | 'danger';

const TONES: Record<Tone, { ring: string; Icon: typeof IconAlert }> = {
  warn: { ring: 'bg-(--color-cue)/15 text-(--color-cue)', Icon: IconAlert },
  danger: { ring: 'bg-red-500/15 text-red-500', Icon: IconTrash },
};

/**
 * The behaviour every overlay owes the keyboard, in one place.
 *
 * Shared because it is exactly the part that rots when it is copied: the capture phase
 * on Escape, focusing something inside on open, and putting focus back where it came
 * from on close. Returns the ref to put on the panel.
 */
export function useOverlay(onDismiss: () => void): React.RefObject<HTMLDivElement | null> {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector('button')?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return panel;
}

export function Modal({
  title,
  detail,
  tone = 'warn',
  children,
  onDismiss,
}: {
  title: string;
  detail?: string | undefined;
  tone?: Tone;
  /** The buttons, least destructive first. */
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const panel = useOverlay(onDismiss);
  const { ring, Icon } = TONES[tone];

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-(--color-line) bg-(--color-surface) shadow-2xl"
      >
        <div className={`h-1 ${tone === 'danger' ? 'bg-red-500' : 'bg-(--color-cue)'}`} />
        <div className="flex gap-4 px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          {/* A mark, not decoration: it says at a glance whether this is "you will lose
              something" or "you are about to destroy something", before the sentence is
              read. */}
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ring}`}>
            <Icon size={21} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-lg font-bold leading-snug">{title}</h2>
            {detail && (
              <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">{detail}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-(--color-line) bg-(--color-raised) px-5 py-4 sm:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}
