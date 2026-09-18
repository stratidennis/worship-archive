import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Destination } from './AppHeader.js';

/**
 * How a page tells the header about itself, without the header being the page's.
 *
 * Every page used to render its own `<AppHeader>`. React reconciles by position, and
 * two different routes are two different subtrees, so navigating tore the header down
 * and built a new one: the logo blinked, the theme button lost its focus, and the whole
 * bar flickered on every click. Which is silly — the header is the one thing on screen
 * that does *not* change when you go somewhere.
 *
 * So there is one header, in a layout route, and it stays mounted. Pages contribute to
 * it two ways:
 *
 *  - **Placement** (`useHeader`) — which destination is current, whether there is a way
 *    back. Plain values, held in state.
 *  - **Content** (`<HeaderTitle>`, `<HeaderActions>`) — a date picker, a Save button, a
 *    song's name. React nodes, so they go through portals rather than through state:
 *    putting elements in state means re-setting them on every render, and a page's
 *    buttons are new elements every render.
 *
 * A portal renders the page's nodes into the header's DOM while leaving them in the
 * page's React tree, which is exactly right — they belong to the page, they unmount
 * with it, and their state and handlers stay where they were written.
 */

export interface HeaderPlacement {
  current?: Destination | undefined;
  back?: boolean | undefined;
}

interface Hosts {
  title: HTMLElement | null;
  actions: HTMLElement | null;
}

interface HeaderSlots {
  placement: HeaderPlacement;
  setPlacement: (placement: HeaderPlacement) => void;
  hosts: Hosts;
  setHosts: React.Dispatch<React.SetStateAction<Hosts>>;
}

const HeaderSlotsContext = createContext<HeaderSlots | null>(null);

export function HeaderSlotsProvider({ children }: { children: React.ReactNode }) {
  const [placement, setPlacement] = useState<HeaderPlacement>({});
  const [hosts, setHosts] = useState<Hosts>({ title: null, actions: null });

  const value = useMemo(
    () => ({ placement, setPlacement, hosts, setHosts }),
    [placement, hosts],
  );
  return <HeaderSlotsContext.Provider value={value}>{children}</HeaderSlotsContext.Provider>;
}

function useSlots(): HeaderSlots | null {
  return useContext(HeaderSlotsContext);
}

/** Read by the header itself. */
export function useHeaderSlots(): HeaderSlots {
  const slots = useSlots();
  if (!slots) throw new Error('useHeaderSlots must be used inside <HeaderSlotsProvider>');
  return slots;
}

/**
 * Tell the header where this page sits.
 *
 * Destructured to primitives on purpose: an object literal would be a new object every
 * render, and setting state from an effect that depends on a new object every render is
 * an infinite loop with extra steps.
 */
export function useHeader({ current, back = false }: HeaderPlacement): void {
  const slots = useSlots();
  const set = slots?.setPlacement;
  useEffect(() => {
    set?.({ current, back });
  }, [set, current, back]);
}

export function HeaderTitle({ children }: { children: React.ReactNode }) {
  const host = useSlots()?.hosts.title ?? null;
  return host ? createPortal(children, host) : null;
}

export function HeaderActions({ children }: { children: React.ReactNode }) {
  const host = useSlots()?.hosts.actions ?? null;
  return host ? createPortal(children, host) : null;
}
