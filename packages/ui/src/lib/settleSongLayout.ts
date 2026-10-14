/**
 * Some touch browsers keep the previous font/column metrics until a rendering turn.
 * Never judge a candidate using those stale metrics. Two frames allow style and
 * layout to settle; the bounded retries also handle a busy device. A cancelled frame
 * stops the old song's measurement immediately.
 */
export async function settleSongLayout(
  isApplied: () => boolean,
  nextFrame: () => Promise<boolean>,
): Promise<boolean> {
  for (let frame = 0; frame < 32; frame++) {
    if (!(await nextFrame())) return false;
    if (frame >= 1 && isApplied()) return true;
  }
  return false;
}

/** Check inherited lyric/chord sizes too: the outer size can update before its text. */
export function songFontsApplied(content: HTMLElement, fontPx: number): boolean {
  for (const text of content.querySelectorAll<HTMLElement>('[data-song-font-scale]')) {
    const expected = fontPx * Number(text.dataset.songFontScale);
    if (Math.abs(parseFloat(getComputedStyle(text).fontSize) - expected) >= 0.05) return false;
  }
  return true;
}
