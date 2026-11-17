import { send, type PowerPointReport } from './api.js';
export const presentationApi = {
  findPowerPoints: (songIds: string[], arrangements: Record<string, string[]> = {}) =>
    send<PowerPointReport>('/api/powerpoints/find', 'POST', { songIds, arrangements }),
  createPowerPoints: (songIds: string[], arrangements: Record<string, string[]> = {}) =>
    send<PowerPointReport>('/api/powerpoints/create', 'POST', { songIds, arrangements }),
};
