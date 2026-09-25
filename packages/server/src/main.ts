/**
 * Server entry point for development and for running headless.
 *
 * A thin wrapper: everything of substance is in `start.ts`, which the Electron main
 * process calls too. Binds every interface, because the whole point is that band
 * devices on the same WiFi can reach it.
 */

import { resolve } from 'node:path';
import { startServer } from './start.js';

const running = await startServer({
  dataDir: resolve(process.env['WORSHIP_DATA'] ?? './data'),
  powerpointsDir: resolve(process.env['WORSHIP_POWERPOINTS'] ?? './data/PowerPoints'),
  port: Number(process.env['PORT'] ?? 7374),
  host: process.env['HOST'] ?? '0.0.0.0',
  uiDir: process.env['WORSHIP_UI'],
});

console.log(`\n  Local:   http://localhost:${running.port}`);
for (const address of running.addresses)
  console.log(`  Network: http://${address}:${running.port}`);
console.log(`  Name:    http://${running.hostname}:${running.port}`);
console.log('');

const shutdown = async (): Promise<void> => {
  await running.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
