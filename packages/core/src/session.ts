/**
 * The live session protocol.
 *
 * One service, one authoritative state, held by the host and pushed to everyone. The
 * whole state goes out on every change — it is a few hundred bytes, and sending it
 * whole is what makes reconnection trivial: a client that missed messages gets the
 * truth in the next frame rather than having to replay a log.
 */

/**
 * What the screens are showing.
 *
 * `black` used to be a third option, beside `cleared`. Two buttons that both mean "stop
 * showing the song" is one button too many at the moment you need either of them — and
 * on a projector the difference between a blank slide and a black one is not something
 * a congregation can tell apart.
 */
export type OutputMode = 'live' | 'cleared';
export type DeviceRole = 'leader' | 'band' | 'stage';

export interface SessionState {
  /** The set being led, or null when no service is running. */
  setId: string | null;
  /**
   * Index into the set's items.
   *
   * A whole item, never part of one. The leader used to be able to push a single
   * section — verse two on its own — to the stage, and it was the one feature nobody
   * used: what a congregation needs on screen is the song they are singing, and what a
   * musician needs is the song they are playing. Choosing a fragment only created a way
   * for the screens to be showing less than the room was doing.
   */
  itemIndex: number;
  output: OutputMode;

  /** Beats per minute, or null when the metronome is off. */
  tempo: number | null;
  beatsPerBar: number;
  /**
   * Host clock time of beat zero, in ms.
   *
   * The beat is not broadcast. Every device derives it from this anchor, so network
   * jitter cannot make the metronome stutter and two musicians can never see different
   * downbeats — provided they have corrected for clock offset, which `ping` exists for.
   */
  beatEpoch: number | null;

  /** Applied on top of each song's own written→performance shift. */
  transpose: number;
  /** Monotonic; lets a client ignore a frame that arrives out of order. */
  rev: number;
}

export const INITIAL_SESSION: SessionState = {
  setId: null,
  itemIndex: 0,
  output: 'live',
  tempo: null,
  beatsPerBar: 4,
  beatEpoch: null,
  transpose: 0,
  rev: 0,
};

export interface DeviceInfo {
  id: string;
  name: string;
  role: DeviceRole;
  /** ISO time the device joined. */
  since: string;
}

/** Everything the host sends. */
export type ServerMessage =
  | { t: 'session'; state: SessionState }
  | { t: 'devices'; devices: DeviceInfo[] }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'reload'; reason: 'library' };

/** Everything a client sends. */
export type ClientMessage =
  | { t: 'hello'; role: DeviceRole; name: string; deviceId?: string }
  | { t: 'patch'; patch: Partial<Omit<SessionState, 'rev'>> }
  | { t: 'ping'; clientTime: number };

/**
 * Which beat of the bar is sounding now, or null when the metronome is off.
 *
 * `clockOffset` is `serverTime - clientTime`, measured by {@link estimateClockOffset}.
 * Without it, devices whose clocks differ by a second would blink a second apart, which
 * is worse than no metronome at all.
 */
export function beatAt(
  state: SessionState,
  now: number,
  clockOffset = 0,
): { beat: number; isDownbeat: boolean } | null {
  if (state.tempo === null || state.tempo <= 0 || state.beatEpoch === null) return null;
  const msPerBeat = 60000 / state.tempo;
  const elapsed = now + clockOffset - state.beatEpoch;
  if (elapsed < 0) return null;
  const index = Math.floor(elapsed / msPerBeat);
  const beat = ((index % state.beatsPerBar) + state.beatsPerBar) % state.beatsPerBar;
  return { beat, isDownbeat: beat === 0 };
}

/** Milliseconds until the next beat — for scheduling an animation frame. */
export function msToNextBeat(state: SessionState, now: number, clockOffset = 0): number | null {
  if (state.tempo === null || state.tempo <= 0 || state.beatEpoch === null) return null;
  const msPerBeat = 60000 / state.tempo;
  const elapsed = now + clockOffset - state.beatEpoch;
  const into = ((elapsed % msPerBeat) + msPerBeat) % msPerBeat;
  return msPerBeat - into;
}

/**
 * Estimate `serverTime - clientTime` from a ping round trip.
 *
 * The usual assumption: the request and the response took about the same time, so the
 * server's clock reading corresponds to the midpoint of the round trip.
 */
export function estimateClockOffset(
  clientSent: number,
  serverTime: number,
  clientReceived: number,
): number {
  return serverTime - (clientSent + clientReceived) / 2;
}
