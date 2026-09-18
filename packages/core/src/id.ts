/**
 * A random id that works where the app actually runs.
 *
 * `crypto.randomUUID` is only defined in a **secure context** — HTTPS, or localhost.
 * This app is served over plain HTTP from a laptop on a church WiFi, which is neither,
 * so on every device except the one running the server `crypto.randomUUID` is
 * `undefined` and calling it throws. It did: the band view died on load with
 * "crypto.randomUUID is not a function", and the only reason it was never caught is
 * that every test until now was run against localhost, where it exists.
 *
 * `crypto.getRandomValues` is not gated the same way and is available everywhere, so
 * the UUID is assembled from it by hand — version 4, variant 1, same shape and the same
 * randomness.
 *
 * The last fallback exists so that no browser can make this throw. Nothing here is a
 * security boundary: these ids name a section of a song and tell two tabs apart.
 */
interface WebCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

export function randomId(): string {
  // Typed structurally rather than as `Crypto`: this file is shared by the browser and
  // by Node, and the point of it is that neither method is guaranteed to be there.
  const source = (globalThis as { crypto?: WebCrypto }).crypto;

  if (typeof source?.randomUUID === 'function') return source.randomUUID();

  if (typeof source?.getRandomValues === 'function') {
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const block = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${block(8)}-${block(4)}-4${block(3)}-a${block(3)}-${block(12)}`;
}
