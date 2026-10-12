/** The next visible song, with no wrapping at either end of the list. */
export function adjacentSong<T>(
  songs: readonly T[],
  current: T | null,
  direction: 1 | -1,
): T | undefined {
  const index = current === null ? -1 : songs.indexOf(current);
  return songs[index + direction];
}
