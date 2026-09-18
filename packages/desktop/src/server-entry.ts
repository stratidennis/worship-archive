/**
 * The bundle entry used by the smoke test.
 *
 * Exists so the test bundles the server through the same path the app does, rather than
 * importing TypeScript sources that the packaged app never sees.
 */
export { startServer } from '@worship/server';
