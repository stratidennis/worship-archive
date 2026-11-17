import { androidBand } from './androidBand.js';
import { clientDesktop } from './clientDesktop.js';
import { desktop } from './desktop.js';

declare const __PRESENTATIONS__: boolean;
export const presentationsBundled =
  typeof __PRESENTATIONS__ === 'undefined' || __PRESENTATIONS__;
/** Native bridges describe host capabilities; viewport size is irrelevant. */
export function supportsPresentations(role: 'leader' | 'band' = 'leader'): boolean {
  return (
    presentationsBundled &&
    !androidBand() &&
    (role === 'leader' || !!clientDesktop() || !!desktop())
  );
}
