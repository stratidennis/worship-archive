import { useEffect, useRef } from 'react';

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
export function Modal({
  title,
  detail,
  children,
  onDismiss,
}: {
  title: string;
  detail?: string | undefined;
  /** The buttons, least destructive first. */
  children: React.ReactNode;
  onDismiss: () => void;
}) {
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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-xl border border-(--color-line) bg-(--color-surface) p-5 shadow-xl"
      >
        <h2 className="text-lg font-bold">{title}</h2>
        {detail && <p className="mt-1 text-sm text-(--color-muted)">{detail}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}
