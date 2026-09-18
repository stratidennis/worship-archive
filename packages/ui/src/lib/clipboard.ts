/**
 * Copy some text, wherever the app happens to be running.
 *
 * `navigator.clipboard` is **secure context only** — HTTPS, or localhost. This app is
 * served over plain HTTP from a laptop on a church WiFi, and the join screen in
 * particular is the one you open at the machine's own LAN address so the QR code points
 * somewhere a phone can reach. At that address `navigator.clipboard` is `undefined`, so
 * a copy button written the modern way would throw on the exact page that needs it.
 *
 * `document.execCommand('copy')` is deprecated and still works everywhere, including
 * insecure contexts, so it is the fallback. It has to act on a real, selected, visible
 * element — `display: none` or `visibility: hidden` and the selection is empty and the
 * copy silently does nothing — hence a transparent field parked off the layout.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused, or an insecure context that exposes the API but not the
    // ability. Either way there is still the old road.
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.left = '0';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch {
    return false;
  }
}
