/**
 * A Band musician's chord-key choices for one live service.
 *
 * These deliberately do not use localStorage: a bass player's choice for rehearsal is
 * useful while moving around that set, but must not leak into the next service. The
 * Leader's session epoch is the boundary between those two situations.
 */
export interface BandKeyChoices {
  sessionId: string | null;
  bySongId: Record<string, string>;
}

export const EMPTY_BAND_KEY_CHOICES: BandKeyChoices = {
  sessionId: null,
  bySongId: {},
};

/** Return a remembered choice only when it belongs to the current live session. */
export function rememberedBandKey(
  choices: BandKeyChoices,
  sessionId: string | null,
  songId: string | null,
): string | null {
  if (!sessionId || !songId || choices.sessionId !== sessionId) return null;
  return choices.bySongId[songId] ?? null;
}

/** Add, replace, or clear one song choice, discarding choices from an older session. */
export function rememberBandKey(
  choices: BandKeyChoices,
  sessionId: string | null,
  songId: string | null,
  key: string | null,
): BandKeyChoices {
  if (!sessionId || !songId) return EMPTY_BAND_KEY_CHOICES;
  const bySongId = choices.sessionId === sessionId ? { ...choices.bySongId } : {};
  if (key) bySongId[songId] = key;
  else delete bySongId[songId];
  return { sessionId, bySongId };
}

/**
 * Resolve this device's chord key.
 *
 * A musician's explicit choice is always strongest. The persistent Band preference
 * only changes the no-choice fallback from the Leader's chord shapes to the sounding
 * performance key.
 */
export function resolveBandDisplayedKey({
  manualKey,
  alwaysUsePerformanceKey,
  performanceKey,
  leaderDisplayedKey,
}: {
  manualKey: string | null;
  alwaysUsePerformanceKey: boolean;
  performanceKey: string | null;
  leaderDisplayedKey: string | null;
}): string | null {
  return (
    manualKey ??
    (alwaysUsePerformanceKey ? (performanceKey ?? leaderDisplayedKey) : leaderDisplayedKey)
  );
}
