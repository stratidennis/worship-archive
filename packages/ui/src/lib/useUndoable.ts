import { useCallback, useRef, useState } from 'react';

/**
 * Undo/redo by snapshot.
 *
 * The edit operations in `@worship/core` are pure, so a history is just a list of past
 * values — no inverse operations to get subtly wrong, and no way for undo to be the
 * thing that loses work.
 *
 * Consecutive edits of the same kind coalesce (`mergeKey`), so typing a word is one
 * undo step rather than eight. Changing block type, adding a chord, or pausing for a
 * moment all start a new step.
 */

const COALESCE_MS = 600;
const LIMIT = 200;

export interface Undoable<T> {
  value: T;
  set: (next: T | ((current: T) => T), mergeKey?: string) => void;
  /** Replace without touching history — for loading, or accepting a server response. */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoable<T>(initial: T): Undoable<T> {
  const [value, setValue] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastKey = useRef<string | null>(null);
  const lastAt = useRef(0);
  const [, force] = useState(0);

  const set = useCallback((next: T | ((current: T) => T), mergeKey?: string) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
      if (Object.is(resolved, current)) return current;

      const now = Date.now();
      const coalesce =
        mergeKey !== undefined &&
        mergeKey === lastKey.current &&
        now - lastAt.current < COALESCE_MS;

      if (!coalesce) {
        past.current = [...past.current, current].slice(-LIMIT);
        future.current = [];
      }
      lastKey.current = mergeKey ?? null;
      lastAt.current = now;
      return resolved;
    });
    force((n) => n + 1);
  }, []);

  const reset = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    lastKey.current = null;
    setValue(next);
    force((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    setValue((current) => {
      const previous = past.current.at(-1);
      if (previous === undefined) return current;
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current];
      lastKey.current = null;
      return previous;
    });
    force((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    setValue((current) => {
      const next = future.current[0];
      if (next === undefined) return current;
      future.current = future.current.slice(1);
      past.current = [...past.current, current];
      lastKey.current = null;
      return next;
    });
    force((n) => n + 1);
  }, []);

  return {
    value,
    set,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
