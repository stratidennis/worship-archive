export interface PresentationOptions {
  repeatMode?: 'compact' | 'expanded';
  allowDraft?: boolean;
}
export type PresentationExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; name: string; relativePath: string }
  | { status: 'external'; name: string; path: string };
import { send, type PowerPointReport } from './api.js';
export const presentationApi = {
  findPowerPoints: (songIds: string[], arrangements: Record<string, string[]> = {}) =>
    send<PowerPointReport>('/api/powerpoints/find', 'POST', { songIds, arrangements }),
  createPowerPoints: (
    songIds: string[],
    arrangements: Record<string, string[]> = {},
    options: PresentationOptions = {},
  ) =>
    send<PowerPointReport>('/api/powerpoints/create', 'POST', {
      songIds,
      arrangements,
      ...options,
    }),
};
