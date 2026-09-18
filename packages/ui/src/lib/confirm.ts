import { useSyncExternalStore } from 'react';

/**
 * "Are you sure?", asked from anywhere.
 *
 * A promise, because that is what the call sites want — `if (!(await confirmAction(…)))
 * return;` reads as one decision rather than as a callback and a piece of dialog state
 * on every page that can delete something. The dialog itself is mounted once, at the
 * root; this is only the wire between them.
 *
 * Deliberately a module-level store rather than context: a confirmation can be asked
 * for from an event handler deep inside a component that has no business knowing a
 * dialog exists, and `await` is the whole point.
 */

export interface ConfirmOptions {
  /** The question. Short, and naming the thing — "Delete the set “20 Sept”?" */
  message: string;
  detail?: string | undefined;
  confirmLabel?: string | undefined;
  /** Colours the confirming button as destructive. */
  danger?: boolean | undefined;
}

interface Pending extends ConfirmOptions {
  resolve: (answer: boolean) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // A second question while one is open answers the first with "no". It cannot be shown
  // anyway, and leaving its promise unsettled would hang whatever is awaiting it.
  pending?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

export function answerConfirm(answer: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(answer);
}

export function usePendingConfirm(): Pending | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => null,
  );
}
