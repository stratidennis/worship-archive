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
export type ThemeName = 'auto' | 'light' | 'dark' | 'stage';
export type LanguageName = 'ro' | 'en';

/**
 * Increment only when a released client can no longer speak to a released host.
 *
 * Application versions may differ while this remains equal. Keeping the wire version
 * separate lets a Stage PC stay useful while the Leader receives an unrelated UI fix.
 */
export const SESSION_PROTOCOL_VERSION = 1;

/**
 * A tiny UDP fallback for installed clients on networks where multicast DNS is not
 * available. Windows can also give two separately installed Electron clients
 * different firewall treatment, so discovery cannot rely on mDNS alone.
 */
export const LAN_DISCOVERY_PORT = 7371;
export const LAN_DISCOVERY_REQUEST = `worship-archive-discover:${SESSION_PROTOCOL_VERSION}`;

/**
 * How the stage screens should look, decided once for all of them.
 *
 * A stage display has nobody standing at it. It is a television on a bracket, and the
 * person who needs to change how it looks — the text is too small at the back, the
 * chords are washed out under the lights — is the one at the laptop, who cannot reach
 * it and should not have to. So these live with the session, which the host owns and
 * pushes to every device, rather than in each screen's own storage.
 *
 * `null` means "whatever that screen would do on its own", which is what an
 * untouched installation should be: one setting to change, not four to keep in step.
 *
 * Whether chords are shown is deliberately *not* here. That one is genuinely per
 * screen — the monitor facing the band wants them and the one facing the room does
 * not — so it stays a query parameter on the address you set that screen up with.
 */
export interface StageDisplay {
  theme: ThemeName | null;
  language: LanguageName | null;
  /** A ceiling for the fit, in pixels. Null leaves the stage's own generous default. */
  maxFontPx: number | null;
  /** Any CSS colour, or null for the theme's own accent. */
  chordColor: string | null;
}

/**
 * What the leader's own screen looks like at this moment.
 *
 * Published by the leader's device, and the reason it exists is a genuinely confusing
 * failure: "as the screen" for a stage display meant *that television's own* settings,
 * which nobody has ever chosen — a browser opened on a TV is whatever the defaults are.
 * So a leader working in English, having set the screens to follow along, watched them
 * stay in Romanian, and the setting looked broken rather than misunderstood.
 *
 * Mirroring the leader is what people mean, so that is what the unset state now does,
 * and this is where the thing being mirrored is kept.
 *
 * The theme here is **resolved**, never `auto`: "match the system" published as-is
 * would mean the *television's* system, which is exactly the misunderstanding again,
 * one level down. The leader's laptop in dark mode publishes `dark`.
 *
 * Text size is deliberately absent. A ceiling chosen for a laptop on a music stand is
 * not a ceiling for a television across a hall — that one is not a thing to mirror,
 * and the screens' own generous default is the right answer.
 */
export interface HostDisplay {
  theme: Exclude<ThemeName, 'auto'>;
  language: LanguageName;
  chordColor: string | null;
}

/** A remembered Stage device. The id is the map key; the name is only its editable label. */
export interface StageDeviceDisplay {
  name: string;
  display: StageDisplay;
}

export const DEFAULT_STAGE_DISPLAY: StageDisplay = {
  theme: null,
  language: null,
  maxFontPx: null,
  chordColor: null,
};

/** True when a screen's settings say nothing at all, and can be forgotten entirely. */
export function isStageDisplayEmpty(display: StageDisplay): boolean {
  return (
    display.theme === null &&
    display.language === null &&
    display.maxFontPx === null &&
    display.chordColor === null
  );
}

/**
 * Apply a partial change.
 *
 * Three states, not two: a field that is absent means "leave it", and a field that is
 * explicitly `null` means "give that screen its own back". Collapsing those two is the
 * easy mistake, and it leaves no way to undo a choice once made.
 */
export function patchStageDisplay(
  current: StageDisplay,
  patch: Partial<StageDisplay>,
): StageDisplay {
  return {
    theme: patch.theme !== undefined ? patch.theme : current.theme,
    language: patch.language !== undefined ? patch.language : current.language,
    maxFontPx: patch.maxFontPx !== undefined ? patch.maxFontPx : current.maxFontPx,
    chordColor: patch.chordColor !== undefined ? patch.chordColor : current.chordColor,
  };
}

/**
 * What one screen should actually look like.
 *
 * Installed screens are matched by stable device id, so renaming one cannot discard
 * its settings. `screen` remains as compatibility for browser links and installations
 * configured before stable ids existed.
 *
 * Language and font size may be configured per screen. Theme and chord colour always
 * come from the Leader, so every view in the room uses one colour scheme.
 */
export function resolveStageDisplay(
  state: SessionState,
  screen: string | null,
  deviceId?: string | null,
): StageDisplay {
  const own =
    (deviceId && state.stageByDevice[deviceId]?.display) ||
    (screen && state.stageBy[screen]) ||
    null;
  const host = state.host;
  return {
    // Colour belongs to the Leader. A separate Stage or Band palette makes the room
    // disagree with the screen it is being led from, so old per-screen colour values
    // remain readable for compatibility but deliberately no longer take effect.
    theme: host?.theme ?? null,
    language: own?.language ?? state.stage.language ?? host?.language ?? null,
    chordColor: host?.chordColor ?? null,
    // Not the leader's. See {@link HostDisplay}.
    maxFontPx: own?.maxFontPx ?? state.stage.maxFontPx,
  };
}

export interface SessionState {
  /**
   * Whether the Leader has deliberately entered Lead mode.
   *
   * A running server is not an active service. Clients are allowed to connect before
   * rehearsal and must remain on their waiting screen until this becomes true.
   */
  active: boolean;
  /** Stable identity of the Leader installation, independent of its changing IP. */
  leaderId: string;
  /** New for every false -> true transition, so a new service is unambiguous. */
  sessionEpoch: string | null;
  /**
   * Increases on every change made by the Leader console.
   *
   * Band devices use this to know when a newer Leader choice supersedes a local key or
   * capo override. `rev` also changes for administrative settings, so it cannot serve
   * that narrower purpose.
   */
  leaderRevision: number;

  /** The selected set. It can remain cached while `active` is false. */
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

  /** How the stage screens should look. See {@link StageDisplay}. */
  stage: StageDisplay;
  /**
   * How the leader's own screen looks, for the screens set to follow it.
   *
   * Null until a leader's device has said. See {@link HostDisplay}.
   */
  host: HostDisplay | null;
  /**
   * Overrides for one named screen, keyed by the name in its address.
   *
   * Empty in a normal installation, and that is the intent: one hall with one screen
   * should never meet this. It exists for the room with a screen at the back and a
   * monitor by the drums, where "large enough to read from thirty metres" and "large
   * enough for the bass player" are not the same number.
   */
  stageBy: Record<string, StageDisplay>;
  /** Stable per-device overrides. `stageBy` remains as migration support for old links. */
  stageByDevice: Record<string, StageDeviceDisplay>;

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
  active: false,
  leaderId: '',
  sessionEpoch: null,
  leaderRevision: 0,
  setId: null,
  itemIndex: 0,
  output: 'live',
  stage: DEFAULT_STAGE_DISPLAY,
  stageBy: {},
  stageByDevice: {},
  host: null,
  tempo: null,
  beatsPerBar: 4,
  beatEpoch: null,
  transpose: 0,
  rev: 0,
};

export interface DeviceInfo {
  /** This connection. A reload gets a new one. */
  id: string;
  /**
   * The device behind it, as that device knows itself.
   *
   * Survives a reconnect, which is what makes the leader's own row in the list
   * identifiable as *this laptop* rather than as one more anonymous entry. Null only
   * in the moments before a device has said hello.
   */
  deviceId: string | null;
  name: string;
  role: DeviceRole;
  /** Wire protocol understood by this device. */
  protocolVersion: number;
  /** ISO time the device joined. */
  since: string;
}

/** Everything the host sends. */
export type ServerMessage =
  | { t: 'session'; state: SessionState }
  | { t: 'devices'; devices: DeviceInfo[] }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'reload'; reason: 'library' }
  | { t: 'incompatible'; serverProtocol: number; clientProtocol: number };

/** Fields that only the host may derive; no WebSocket client is allowed to set them. */
export type SessionPatch = Partial<
  Omit<SessionState, 'rev' | 'leaderId' | 'sessionEpoch' | 'leaderRevision'>
>;

/** Everything a client sends. */
export type ClientMessage =
  | {
      t: 'hello';
      role: DeviceRole;
      name: string;
      deviceId?: string;
      protocolVersion: number;
    }
  | { t: 'patch'; patch: SessionPatch }
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
