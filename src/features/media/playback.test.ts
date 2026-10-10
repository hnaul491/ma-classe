import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  AUTOPLAY_MAX_WAIT_MS,
  AUTOPLAY_TIMEOUT_MS,
  autoplayVerdict,
  classifyObserved,
  createEchoGuard,
  createSyncEcho,
  createStallTracker,
  stallVia,
  stampArrival,
  SYNC_ECHO_TTL_MS,
  routeMessage,
  ECHO_GUARD_MS,
  isAutoplayRejection,
  isLocalChange,
  isSeekJump,
  missedAction,
  SEEK_JUMP_S,
  SEEK_MAX_GAP_MS,
  shouldHeartbeat,
  stateMessage,
  YT_BUFFERING,
  YT_CUED,
  YT_ENDED,
  YT_PAUSED,
  YT_PLAYING,
  YT_UNSTARTED,
  ytObserved,
  ytSample,
} from './playback';
import type { MediaSource } from './protocol';
import { HEARTBEAT_MS, type MediaState } from './sync';

const yt: MediaSource = { kind: 'youtube', videoId: 'dQw4w9WgXcQ' };
const playing: MediaState = { source: yt, playing: true, position: 10, sentAt: 1000, lamport: 3, by: 'teacher' };
const paused: MediaState = { ...playing, playing: false };

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createEchoGuard', () => {
  it('ignores player events for 500 ms after applying a remote state', () => {
    const c = clock();
    const g = createEchoGuard(c.now);
    expect(g.active()).toBe(false);
    g.begin();
    expect(g.active()).toBe(true);
    c.advance(ECHO_GUARD_MS - 1);
    expect(g.active()).toBe(true);
    c.advance(1);
    expect(g.active()).toBe(false);
    expect(ECHO_GUARD_MS).toBe(500);
  });

  it('a new apply extends the window', () => {
    const c = clock();
    const g = createEchoGuard(c.now);
    g.begin();
    c.advance(400);
    g.begin();
    c.advance(400);
    expect(g.active()).toBe(true);
  });

  it('holds while a play is pending, then keeps a 500 ms tail after release', () => {
    const c = clock();
    const g = createEchoGuard(c.now);
    const release = g.hold();
    c.advance(10_000);
    expect(g.active()).toBe(true);
    release();
    expect(g.active()).toBe(true);
    c.advance(ECHO_GUARD_MS);
    expect(g.active()).toBe(false);
  });

  it('releasing twice counts once; two holds need two releases', () => {
    const c = clock();
    const g = createEchoGuard(c.now);
    const a = g.hold();
    const b = g.hold();
    a();
    a();
    c.advance(ECHO_GUARD_MS);
    expect(g.active()).toBe(true);
    b();
    c.advance(ECHO_GUARD_MS);
    expect(g.active()).toBe(false);
  });
});

describe('isLocalChange', () => {
  it('a pause while playing, or a play while paused, is a change', () => {
    expect(isLocalChange(playing, { playing: false, position: 10 }, 1000)).toBe(true);
    expect(isLocalChange(paused, { playing: true, position: 10 }, 1000)).toBe(true);
  });

  it('a seek beyond the drift threshold is a change', () => {
    expect(isLocalChange(paused, { playing: false, position: 40 }, 1000)).toBe(true);
    // Playing: the target moves on with time (10 s + 5 s), so 15 s is where it should be.
    expect(isLocalChange(playing, { playing: true, position: 15 }, 6000)).toBe(false);
    expect(isLocalChange(playing, { playing: true, position: 10 }, 6000)).toBe(true);
  });

  it('an event that matches the shared state is an echo, not a change (a late PLAYING after buffering)', () => {
    expect(isLocalChange(playing, { playing: true, position: 10.4 }, 1000)).toBe(false);
    expect(isLocalChange(paused, { playing: false, position: 10 }, 99_000)).toBe(false);
  });

  it('nothing is a change while no media is loaded', () => {
    expect(isLocalChange({ ...playing, source: null }, { playing: false, position: 0 }, 1000)).toBe(false);
  });
});

describe('shouldHeartbeat', () => {
  it('only the person who acted last sends it, and only while playing', () => {
    expect(shouldHeartbeat(playing, 'teacher')).toBe(true);
    expect(shouldHeartbeat(playing, 'student')).toBe(false);
    expect(shouldHeartbeat(paused, 'teacher')).toBe(false);
    expect(shouldHeartbeat({ ...playing, source: null }, 'teacher')).toBe(false);
    expect(HEARTBEAT_MS).toBe(5000);
  });
});

describe('stateMessage', () => {
  it('is the state at the player’s position now, keeping the lamport and who acted (heartbeat and reply)', () => {
    expect(stateMessage(playing, 42.5, 9000)).toEqual({
      t: 'media-state',
      source: yt,
      playing: true,
      position: 42.5,
      sentAt: 9000,
      lamport: 3,
      by: 'teacher',
    });
  });

  it('without a player, uses where playback should be', () => {
    expect(stateMessage(playing, null, 3000)?.position).toBeCloseTo(12);
    expect(stateMessage(paused, null, 3000)?.position).toBe(10);
  });

  it('never sends a negative position', () => {
    expect(stateMessage(playing, -0.2, 3000)?.position).toBe(0);
  });

  it('is null before anyone acted: nothing to hand over', () => {
    expect(stateMessage({ source: null, playing: false, position: 0, sentAt: 0, lamport: 0, by: null }, null, 1)).toBeNull();
  });

  it('hands over a closed media too (source null), so a reload does not reopen it', () => {
    expect(stateMessage({ source: null, playing: false, position: 0, sentAt: 5, lamport: 4, by: 'student' }, null, 9)).toMatchObject({
      source: null,
      lamport: 4,
    });
  });
});

describe('applyPlan', () => {
  it('seeks only beyond the drift threshold', () => {
    expect(applyPlan(paused, { position: 10.5, playing: false }, 5000)).toEqual({ seekTo: null, play: false, pause: false });
    expect(applyPlan(paused, { position: 30, playing: false }, 5000)).toEqual({ seekTo: 10, play: false, pause: false });
  });

  it('plays from where the other person is now (a reload mid-video)', () => {
    const plan = applyPlan({ ...playing, position: 120, sentAt: 5000 }, { position: 0, playing: false }, 5250);
    expect(plan.play).toBe(true);
    expect(plan.pause).toBe(false);
    expect(plan.seekTo).toBeCloseTo(120.25);
  });

  it('pauses a playing player for a paused state', () => {
    expect(applyPlan(paused, { position: 10, playing: true }, 1000)).toEqual({ seekTo: null, play: false, pause: true });
  });

  it('does nothing when the player already matches', () => {
    expect(applyPlan(playing, { position: 12.2, playing: true }, 3000)).toEqual({ seekTo: null, play: false, pause: false });
  });
});

describe('autoplayVerdict', () => {
  it('playing as soon as the player reports PLAYING', () => {
    expect(autoplayVerdict(YT_PLAYING, 100)).toBe('playing');
    expect(autoplayVerdict(YT_PLAYING, 9000)).toBe('playing');
  });

  it('blocked when PLAYING is not reached within 1.5 s', () => {
    expect(AUTOPLAY_TIMEOUT_MS).toBe(1500);
    for (const s of [YT_UNSTARTED, YT_PAUSED, YT_CUED, YT_ENDED]) {
      expect(autoplayVerdict(s, AUTOPLAY_TIMEOUT_MS - 1)).toBe('wait');
      expect(autoplayVerdict(s, AUTOPLAY_TIMEOUT_MS)).toBe('blocked');
    }
  });

  it('a slow connection still buffering gets more time, up to a limit', () => {
    expect(autoplayVerdict(YT_BUFFERING, AUTOPLAY_TIMEOUT_MS)).toBe('wait');
    expect(autoplayVerdict(YT_BUFFERING, AUTOPLAY_MAX_WAIT_MS - 1)).toBe('wait');
    expect(autoplayVerdict(YT_BUFFERING, AUTOPLAY_MAX_WAIT_MS)).toBe('blocked');
  });

  it('a PAUSED while a play is pending (even after BUFFERING, as mobile Safari refuses it) is blocked, never a pause', () => {
    // Only three outcomes: a refused play never reads as the person’s pause, so it is never broadcast.
    const outcomes = new Set<string>();
    for (const elapsed of [0, 600, AUTOPLAY_TIMEOUT_MS - 1, AUTOPLAY_TIMEOUT_MS, AUTOPLAY_MAX_WAIT_MS]) outcomes.add(autoplayVerdict(YT_PAUSED, elapsed));
    expect([...outcomes].sort()).toEqual(['blocked', 'wait']);
    expect(autoplayVerdict(YT_PAUSED, AUTOPLAY_TIMEOUT_MS)).toBe('blocked');
    // A blocked player has no missed action at guard end: its PAUSED is not sent.
    expect(missedAction(playing, { playing: false, position: 10 }, 1500, true)).toBeNull();
  });
});

describe('isSeekJump', () => {
  it('a playing video moving with the clock is not a seek', () => {
    expect(isSeekJump({ at: 0, position: 10, playing: true }, { at: 500, position: 10.5, playing: true })).toBe(false);
  });

  it('a jump beyond the threshold is a seek, forward or back, playing or paused', () => {
    expect(SEEK_JUMP_S).toBe(1);
    expect(isSeekJump({ at: 0, position: 10, playing: true }, { at: 500, position: 40, playing: true })).toBe(true);
    expect(isSeekJump({ at: 0, position: 40, playing: true }, { at: 500, position: 5, playing: true })).toBe(true);
    expect(isSeekJump({ at: 0, position: 10, playing: false }, { at: 500, position: 11.2, playing: false })).toBe(true);
    expect(isSeekJump({ at: 0, position: 10, playing: false }, { at: 500, position: 10.9, playing: false })).toBe(false);
  });

  it('a buffering stall or a play started between samples is not a seek', () => {
    expect(isSeekJump({ at: 0, position: 10, playing: true }, { at: 500, position: 10, playing: true })).toBe(false);
    expect(isSeekJump({ at: 0, position: 10, playing: false }, { at: 500, position: 10.4, playing: true })).toBe(false);
  });

  it('after a long gap (a throttled background tab) it only resets the baseline', () => {
    expect(isSeekJump({ at: 0, position: 10, playing: true }, { at: SEEK_MAX_GAP_MS + 1, position: 60, playing: true })).toBe(false);
    expect(isSeekJump({ at: 500, position: 10, playing: true }, { at: 500, position: 60, playing: true })).toBe(false);
  });
});

describe('ytObserved', () => {
  it('PLAYING is a play, PAUSED and ENDED are a pause, the rest is not an action', () => {
    expect(ytObserved(YT_PLAYING, 3)).toEqual({ playing: true, position: 3 });
    expect(ytObserved(YT_PAUSED, 4)).toEqual({ playing: false, position: 4 });
    expect(ytObserved(YT_ENDED, 5)).toEqual({ playing: false, position: 5 });
    expect(ytObserved(YT_BUFFERING, 6)).toBeNull();
    expect(ytObserved(YT_CUED, 0)).toBeNull();
    expect(ytObserved(YT_UNSTARTED, 0)).toBeNull();
  });
});

describe('ytSample', () => {
  it('samples the time while playing or paused', () => {
    expect(ytSample(YT_PLAYING, 12, 500)).toEqual({ at: 500, position: 12, playing: true });
    expect(ytSample(YT_PAUSED, 12, 500)).toEqual({ at: 500, position: 12, playing: false });
  });

  it('is null while buffering, so a stall never looks like a seek (the PLAYING after it reports a seek)', () => {
    expect(ytSample(YT_BUFFERING, 12, 500)).toBeNull();
  });
});

describe('isAutoplayRejection', () => {
  it('only NotAllowedError means the browser blocked play()', () => {
    expect(isAutoplayRejection(new DOMException('blocked', 'NotAllowedError'))).toBe(true);
    // A pause() that interrupts play() rejects with AbortError: not blocked.
    expect(isAutoplayRejection(new DOMException('interrupted', 'AbortError'))).toBe(false);
    expect(isAutoplayRejection(new Error('x'))).toBe(false);
    expect(isAutoplayRejection(undefined)).toBe(false);
  });
});

describe('createEchoGuard.remaining', () => {
  it('says how long until the window ends, so a swallowed action can be checked then', () => {
    const c = clock();
    const g = createEchoGuard(c.now);
    expect(g.remaining()).toBe(0);
    g.begin();
    c.advance(200);
    expect(g.remaining()).toBe(ECHO_GUARD_MS - 200);
    const release = g.hold();
    expect(g.remaining()).toBe(Infinity);
    release();
    expect(g.remaining()).toBe(ECHO_GUARD_MS);
    c.advance(ECHO_GUARD_MS);
    expect(g.remaining()).toBe(0);
  });
});

describe('routeMessage', () => {
  const ctx = { self: 'teacher' as const, position: 31.5, now: 2000 };
  const mine: MediaState = { source: yt, playing: true, position: 30, sentAt: 500, lamport: 6, by: 'teacher' };
  const other: MediaSource = { kind: 'youtube', videoId: 'aaaaaaaaaaa' };
  const stateMsg = (o: Partial<MediaState>) => ({ t: 'media-state' as const, ...mine, by: 'teacher' as const, ...o }) as Extract<
    import('./protocol').MediaMessage,
    { t: 'media-state' }
  >;

  it('answers media-req to the asker only, with the live position', () => {
    const r = routeMessage(mine, { t: 'media-req' }, 'student@x', ctx);
    expect(r.next).toBe(mine);
    expect(r.reply).toEqual({ to: ['student@x'], msg: { ...stateMsg({ position: 31.5, sentAt: 2000 }) } });
    expect(r.syncPlayer).toBe(false);
  });

  it('does not answer media-req before anyone acted', () => {
    const initial: MediaState = { source: null, playing: false, position: 0, sentAt: 0, lamport: 0, by: null };
    expect(routeMessage(initial, { t: 'media-req' }, 'student@x', ctx).reply).toBeNull();
  });

  it('adopts a newer state; the same media syncs the player now, a new one waits for its player', () => {
    const same = routeMessage(mine, stateMsg({ lamport: 7, by: 'student', playing: false }), 'student@x', ctx);
    expect(same.next.lamport).toBe(7);
    expect(same.reply).toBeNull();
    expect(same.syncPlayer).toBe(true);
    const fresh = routeMessage(mine, stateMsg({ lamport: 7, by: 'student', source: other }), 'student@x', ctx);
    expect(fresh.next.source).toEqual(other);
    expect(fresh.syncPlayer).toBe(false);
  });

  it('answers a stale state with mine, to its sender', () => {
    const r = routeMessage(mine, stateMsg({ lamport: 2, by: 'student' }), 'student@x', ctx);
    expect(r.next).toBe(mine);
    expect(r.reply?.to).toEqual(['student@x']);
    expect(r.reply?.msg).toMatchObject({ t: 'media-state', lamport: 6, by: 'teacher', position: 31.5 });
  });

  it('an equal state changes nothing and gets no answer', () => {
    const r = routeMessage(mine, stateMsg({}), 'student@x', ctx);
    expect(r).toEqual({ next: mine, reply: null, syncPlayer: false });
  });

  it('stamps a received state with the arrival time, so the receiver’s clock is the only one used', () => {
    const r = routeMessage(mine, stateMsg({ lamport: 7, by: 'student', sentAt: 999_999_999 }), 'student@x', ctx);
    expect(r.next.sentAt).toBe(ctx.now);
  });
});

describe('missedAction (when the echo guard ends)', () => {
  it('a play pressed inside the window after a remote pause is still an action', () => {
    const c = clock(1000);
    const g = createEchoGuard(c.now);
    g.begin(); // the remote pause is applied
    c.advance(200); // the person presses play: the event is swallowed
    expect(g.active()).toBe(true);
    c.advance(g.remaining());
    expect(missedAction(paused, { playing: true, position: 10.2 }, c.now(), false)).toEqual({
      kind: 'action',
      observed: { playing: true, position: 10.2 },
    });
    expect(missedAction(playing, { playing: false, position: 10 }, 1000, false)).toEqual({
      kind: 'action',
      observed: { playing: false, position: 10 },
    });
  });

  it('a player still playing but more than 1 s behind after buffering is a local resync, never an action', () => {
    // A remote play at 10 s; the player buffered 2.5 s, so the shared target moved on to 12.5 s.
    expect(missedAction(playing, { playing: true, position: 10 }, 3500, false)).toEqual({ kind: 'resync' });
  });

  it('a position off while paused is a resync too (a seek inside the window may be lost)', () => {
    expect(missedAction(paused, { playing: false, position: 55 }, 1000, false)).toEqual({ kind: 'resync' });
  });

  it('nothing to do when the player matches the synced state', () => {
    expect(missedAction(paused, { playing: false, position: 10 }, 1000, false)).toBeNull();
    expect(missedAction(playing, { playing: true, position: 12 }, 3000, false)).toBeNull();
  });

  it('a blocked player (autoplay) has nothing to do: it is not the person’s doing', () => {
    expect(missedAction(playing, { playing: false, position: 0 }, 3000, true)).toBeNull();
  });
});

describe('classifyObserved (outside the echo guard)', () => {
  // A heartbeat correction seeked to 10 s at t=1000; the player buffered and reports PLAYING at t=3500.
  const late = { playing: true, position: 10 };

  it('a late PLAYING after a sync seek or play is never a user seek: resync locally', () => {
    expect(classifyObserved(playing, late, 'state', 3500, true)).toBe('resync');
  });

  it('a PLAYING after a buffering stall (no jump from before it) only resyncs, even with no sync pending', () => {
    expect(classifyObserved(playing, late, 'stall', 3500, false)).toBe('resync');
  });

  it('a PLAYING whose position jumped from before the buffering is the person’s seek', () => {
    expect(classifyObserved(playing, { playing: true, position: 80 }, 'state', 3500, false)).toBe('action');
  });

  it('a detected seek (time jump, audio seeked) is the person’s, even with a sync pending', () => {
    expect(classifyObserved(playing, { playing: true, position: 80 }, 'seek', 3500, true)).toBe('action');
  });

  it('a play/pause flip is always an action', () => {
    expect(classifyObserved(playing, { playing: false, position: 12 }, 'state', 3000, true)).toBe('action');
    expect(classifyObserved(paused, { playing: true, position: 10 }, 'state', 3000, true)).toBe('action');
  });

  it('an event that matches the shared state is ignored', () => {
    expect(classifyObserved(playing, { playing: true, position: 12.3 }, 'state', 3000, false)).toBe('ignore');
    expect(classifyObserved({ ...playing, source: null }, { playing: false, position: 0 }, 'state', 3000, false)).toBe('ignore');
  });
});

describe('createSyncEcho', () => {
  it('a sync seek or play stays pending until the PLAYING that follows it settles it', () => {
    const c = clock();
    const e = createSyncEcho(c.now);
    expect(e.pending()).toBe(false);
    e.mark();
    c.advance(3000);
    expect(e.pending()).toBe(true);
    e.settle();
    expect(e.pending()).toBe(false);
  });

  it('expires, so a later PLAYING after the person’s own seek is not taken for an echo', () => {
    const c = clock();
    const e = createSyncEcho(c.now);
    e.mark();
    c.advance(SYNC_ECHO_TTL_MS);
    expect(e.pending()).toBe(false);
  });

  it('allows one local resync per sync: a buffering resync cannot loop', () => {
    const c = clock();
    const e = createSyncEcho(c.now);
    expect(e.takeResync()).toBe(false);
    e.mark();
    expect(e.takeResync()).toBe(true);
    // The resync seek re-arms the echo (its own late PLAYING is not a user seek) but no new budget.
    e.rearm();
    expect(e.pending()).toBe(true);
    expect(e.takeResync()).toBe(false);
    e.mark(); // the next remote state or heartbeat correction
    expect(e.takeResync()).toBe(true);
  });

  it('a local action clears both', () => {
    const e = createSyncEcho(clock().now);
    e.mark();
    e.clear();
    expect(e.pending()).toBe(false);
    expect(e.takeResync()).toBe(false);
  });
});

describe('stallVia', () => {
  const before = { at: 0, position: 40, playing: true };

  it('a PLAYING within the seek threshold of the last sample before BUFFERING is a stall', () => {
    expect(stallVia(before, 40.4)).toBe('stall');
    expect(stallVia(before, 41)).toBe('stall');
  });

  it('a jump from that sample is a seek (state), as is a PLAYING with no sample before (our own seek reset it)', () => {
    expect(stallVia(before, 41.2)).toBe('state');
    expect(stallVia(before, 10)).toBe('state');
    expect(stallVia(null, 40)).toBe('state');
  });
});

describe('stampArrival', () => {
  it('replaces sentAt with the local arrival time, keeping everything else', () => {
    const m = { t: 'media-state' as const, source: yt, playing: true, position: 12, sentAt: 5, lamport: 3, by: 'student' as const };
    expect(stampArrival(m, 7000)).toEqual({ ...m, sentAt: 7000 });
  });

  it('heartbeats from the same person stay ordered: a later arrival wins on the reliable, ordered channel', () => {
    const s: MediaState = { source: yt, playing: true, position: 10, sentAt: 1000, lamport: 3, by: 'student' };
    const beat = stampArrival({ t: 'media-state', source: yt, playing: true, position: 15, sentAt: 1, lamport: 3, by: 'student' }, 6000);
    expect(routeMessage(s, beat, 'student@x', { self: 'teacher', position: null, now: 6000 }).next.position).toBe(15);
  });
});

describe('createStallTracker', () => {
  const sample = (at: number, position: number, playing = true) => ({ at, position, playing });

  it('BUFFERING then PLAYING close to where it was: a stall', () => {
    const t = createStallTracker();
    expect(t.onState(YT_BUFFERING, 40.2, 1000, sample(900, 40.1))).toBe('state');
    expect(t.onState(YT_PLAYING, 40.3, 4000, null)).toBe('stall');
  });

  it('BUFFERING then PLAYING far from it: the person seeked (state)', () => {
    const t = createStallTracker();
    t.onState(YT_BUFFERING, 80, 1000, sample(900, 40.1));
    expect(t.onState(YT_PLAYING, 80, 2000, null)).toBe('state');
  });

  it('BUFFERING, PAUSED, then PLAYING: a play from pause, not a stall', () => {
    const t = createStallTracker();
    t.onState(YT_BUFFERING, 40, 1000, sample(900, 40));
    expect(t.onState(YT_PAUSED, 40, 1500, null)).toBe('state');
    expect(t.onState(YT_PLAYING, 40, 3000, null)).toBe('state');
  });

  it('projects a playing sample to the BUFFERING moment (a sample up to 0.5 s old)', () => {
    // Sampled at 40 s, 500 ms before the stall: it was really at 40.5 s when it stalled.
    const t = createStallTracker();
    t.onState(YT_BUFFERING, 40.5, 1000, sample(500, 40));
    expect(t.onState(YT_PLAYING, 41.4, 5000, null)).toBe('stall'); // 0.9 s from 40.5, but 1.4 s from 40
    const back = createStallTracker();
    back.onState(YT_BUFFERING, 40.5, 1000, sample(500, 40));
    expect(back.onState(YT_PLAYING, 39.4, 5000, null)).toBe('state'); // 1.1 s back from 40.5
  });

  it('does not project a paused sample', () => {
    const t = createStallTracker();
    t.onState(YT_BUFFERING, 40, 1000, sample(500, 40, false));
    expect(t.onState(YT_PLAYING, 41.4, 5000, null)).toBe('state');
  });

  it('keeps the first snapshot over repeated BUFFERING, and nothing before it (our own seek reset it) is a state', () => {
    const t = createStallTracker();
    t.onState(YT_BUFFERING, 40, 1000, sample(1000, 40));
    t.onState(YT_BUFFERING, 40, 1300, sample(1300, 70));
    expect(t.onState(YT_PLAYING, 40.4, 3000, null)).toBe('stall');
    const none = createStallTracker();
    none.onState(YT_BUFFERING, 40, 1000, null);
    expect(none.onState(YT_PLAYING, 40, 3000, null)).toBe('state');
  });

  it('a PLAYING with no buffering before it is a state change', () => {
    expect(createStallTracker().onState(YT_PLAYING, 40, 1000, sample(900, 40))).toBe('state');
  });
});
