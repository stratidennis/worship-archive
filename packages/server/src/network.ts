/** Whether an address belongs to this computer rather than another LAN device. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  );
}
