import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAGE_DISPLAY,
  INITIAL_SESSION,
  beatAt,
  estimateClockOffset,
  isStageDisplayEmpty,
  msToNextBeat,
  patchStageDisplay,
  resolveStageDisplay,
  type SessionState,
} from '../src/session.js';

function session(overrides: Partial<SessionState> = {}): SessionState {
  return { ...INITIAL_SESSION, ...overrides };
}

describe('the metronome', () => {
  // 120 bpm = 500 ms per beat, 4 beats to the bar.
  const state = session({ tempo: 120, beatsPerBar: 4, beatEpoch: 1_000_000 });

  it('is off when no tempo is set', () => {
    expect(beatAt(session(), Date.now())).toBeNull();
    expect(msToNextBeat(session(), Date.now())).toBeNull();
  });

  it('is off when there is a tempo but no anchor', () => {
    expect(beatAt(session({ tempo: 120 }), Date.now())).toBeNull();
  });

  it('starts on the downbeat', () => {
    expect(beatAt(state, 1_000_000)).toEqual({ beat: 0, isDownbeat: true });
  });

  it('advances one beat every interval', () => {
    expect(beatAt(state, 1_000_500)?.beat).toBe(1);
    expect(beatAt(state, 1_001_000)?.beat).toBe(2);
    expect(beatAt(state, 1_001_500)?.beat).toBe(3);
  });

  it('wraps to the downbeat at the bar line', () => {
    expect(beatAt(state, 1_002_000)).toEqual({ beat: 0, isDownbeat: true });
  });

  it('holds a beat for its whole duration', () => {
    expect(beatAt(state, 1_000_001)?.beat).toBe(0);
    expect(beatAt(state, 1_000_499)?.beat).toBe(0);
    expect(beatAt(state, 1_000_501)?.beat).toBe(1);
  });

  it('stays silent before the anchor', () => {
    expect(beatAt(state, 999_000)).toBeNull();
  });

  it('handles bars that are not four beats', () => {
    const waltz = session({ tempo: 120, beatsPerBar: 3, beatEpoch: 0 });
    expect(beatAt(waltz, 1500)?.beat).toBe(0);
    expect(beatAt(waltz, 1000)?.beat).toBe(2);
  });

  it('reports the time to the next beat, for scheduling', () => {
    expect(msToNextBeat(state, 1_000_000)).toBe(500);
    expect(msToNextBeat(state, 1_000_100)).toBe(400);
    expect(msToNextBeat(state, 1_000_499)).toBe(1);
  });

  it('corrects for a device whose clock is behind', () => {
    // This device's clock reads a full second early; with the offset applied it must
    // still see the same beat as everyone else.
    const deviceNow = 1_000_500 - 1000;
    expect(beatAt(state, deviceNow, 1000)?.beat).toBe(1);
    expect(beatAt(state, deviceNow)?.beat).not.toBe(1);
  });

  it('corrects for a device whose clock is ahead', () => {
    const deviceNow = 1_001_000 + 750;
    expect(beatAt(state, deviceNow, -750)?.beat).toBe(2);
  });

  it('does not drift over a long song', () => {
    // Five minutes at 120 bpm is 600 beats — an exact number of bars.
    expect(beatAt(state, 1_000_000 + 5 * 60 * 1000)).toEqual({ beat: 0, isDownbeat: true });
  });

  it('survives a nonsensical tempo instead of dividing by zero', () => {
    expect(beatAt(session({ tempo: 0, beatEpoch: 0 }), 1000)).toBeNull();
    expect(beatAt(session({ tempo: -60, beatEpoch: 0 }), 1000)).toBeNull();
  });
});

describe('clock offset estimation', () => {
  it('assumes the round trip was symmetric', () => {
    // Sent at 1000, received at 1200; the server's clock read 5600 at the midpoint.
    expect(estimateClockOffset(1000, 5600, 1200)).toBe(4500);
  });

  it('is zero when the clocks already agree', () => {
    expect(estimateClockOffset(1000, 1100, 1200)).toBe(0);
  });

  it('is negative when the client runs ahead of the server', () => {
    expect(estimateClockOffset(5000, 1100, 5200)).toBeLessThan(0);
  });
});

describe('how a stage screen should look', () => {
  it('starts out saying nothing, so every screen keeps its own', () => {
    expect(isStageDisplayEmpty(DEFAULT_STAGE_DISPLAY)).toBe(true);
    expect(resolveStageDisplay(session(), 'Left')).toEqual(DEFAULT_STAGE_DISPLAY);
  });

  /*
    Absent and null are different requests, and the easy implementation conflates them:
    `patch.theme ?? current.theme` reads an explicit null as "not mentioned", which
    leaves no way to undo a choice once it has been made.
  */
  it('leaves alone a field the patch does not mention', () => {
    const patched = patchStageDisplay(
      { ...DEFAULT_STAGE_DISPLAY, theme: 'dark' },
      {
        maxFontPx: 40,
      },
    );
    expect(patched).toEqual({
      theme: 'dark',
      language: null,
      maxFontPx: 40,
      chordColor: null,
      showChords: null,
    });
  });

  it('clears a field the patch sets to null', () => {
    const patched = patchStageDisplay(
      { ...DEFAULT_STAGE_DISPLAY, theme: 'dark' },
      {
        theme: null,
      },
    );
    expect(patched.theme).toBeNull();
    expect(isStageDisplayEmpty(patched)).toBe(true);
  });

  it('gives an unnamed screen the shared settings', () => {
    const state = session({ stage: { ...DEFAULT_STAGE_DISPLAY, maxFontPx: 60 } });
    expect(resolveStageDisplay(state, null).maxFontPx).toBe(60);
    expect(resolveStageDisplay(state, 'Anything').maxFontPx).toBe(60);
  });

  /* Every screen can differ, while unset values continue through the shared layers. */
  it('lets one screen differ without disturbing the rest', () => {
    const state = session({
      stage: { ...DEFAULT_STAGE_DISPLAY, maxFontPx: 60, chordColor: '#f59e0b' },
      stageBy: { Drums: { ...DEFAULT_STAGE_DISPLAY, maxFontPx: 28 } },
    });
    expect(resolveStageDisplay(state, 'Drums')).toEqual({
      theme: null,
      language: null,
      maxFontPx: 28,
      chordColor: '#f59e0b',
      showChords: null,
    });
    expect(resolveStageDisplay(state, 'Back').maxFontPx).toBe(60);
  });

  /*
    The bug this layer exists for: "leave it alone" used to mean "leave it at whatever
    a browser opened on a television defaults to", which is nobody's decision. A leader
    working in English, having touched nothing, watched the wall stay Romanian.
  */
  it('falls back to the leader\u2019s own screen before the television\u2019s', () => {
    const state = session({ host: { theme: 'dark', language: 'en', chordColor: '#ef4444' } });
    expect(resolveStageDisplay(state, null)).toEqual({
      theme: 'dark',
      language: 'en',
      chordColor: '#ef4444',
      maxFontPx: null,
      showChords: null,
    });
  });

  it('allows a shared screen theme to differ from the leader', () => {
    const state = session({
      stage: { ...DEFAULT_STAGE_DISPLAY, theme: 'stage' },
      host: { theme: 'light', language: 'en', chordColor: null },
    });
    const resolved = resolveStageDisplay(state, null);
    expect(resolved.theme).toBe('stage');
    expect(resolved.language).toBe('en');
  });

  it('allows one screen theme to differ from both shared and leader themes', () => {
    const state = session({
      stage: { ...DEFAULT_STAGE_DISPLAY, theme: 'stage' },
      stageBy: { Drums: { ...DEFAULT_STAGE_DISPLAY, theme: 'light' } },
      host: { theme: 'dark', language: 'ro', chordColor: null },
    });
    expect(resolveStageDisplay(state, 'Drums').theme).toBe('light');
    expect(resolveStageDisplay(state, 'Back').theme).toBe('stage');
  });

  it('keeps a screen override when its editable name changes', () => {
    const state = session({
      stageByDevice: {
        'stage-installation-1': {
          name: 'Old name',
          display: { ...DEFAULT_STAGE_DISPLAY, maxFontPx: 34 },
        },
      },
    });
    expect(resolveStageDisplay(state, 'New name', 'stage-installation-1').maxFontPx).toBe(34);
  });

  /*
    Size is the exception, and deliberately so: a ceiling chosen for a laptop on a
    music stand would be unreadable from the back of a hall.
  */
  it('never takes the text size from the leader\u2019s device', () => {
    const state = session({ host: { theme: 'dark', language: 'ro', chordColor: null } });
    expect(resolveStageDisplay(state, null).maxFontPx).toBeNull();
  });

  it('is unchanged by settings belonging to a screen that is not this one', () => {
    const state = session({ stageBy: { Drums: { ...DEFAULT_STAGE_DISPLAY, theme: 'light' } } });
    expect(resolveStageDisplay(state, 'Back')).toEqual(state.stage);
  });
});
