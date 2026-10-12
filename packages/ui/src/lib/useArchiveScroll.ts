import { useLayoutEffect, useRef } from 'react';
import { readArchiveScroll, rememberArchiveScroll } from './archiveState.js';

/** Restore only after asynchronous results have given the list its final height. */
export function useArchiveScroll<T extends HTMLElement>(view: string, ready: boolean) {
  const ref = useRef<T>(null);
  const restored = useRef(false);
  useLayoutEffect(() => {
    restored.current = false;
    if (!ready || !ref.current) return;
    ref.current.scrollTop = readArchiveScroll(view);
    restored.current = true;
  }, [view, ready]);
  return {
    ref,
    onScroll: () => {
      if (restored.current && ref.current) rememberArchiveScroll(view, ref.current.scrollTop);
    },
  };
}
