import { describe, expect, it } from 'vitest';
import type { MediaSource } from './protocol';
import { INITIAL_MEDIA_STATE, mediaReducer, type MediaState, needsCorrection, targetPosition } from './sync';

describe('targetPosition', () => {
  it('adds the time since sending while playing (250 ms of latency)', () => {
    expect(targetPosition({ playing: true, position: 10, sentAt: 1000 }, 1250)).toBeCloseTo(10.25);
  });

  it('keeps the position while paused', () => {
    expect(targetPosition({ playing: false, position: 10, sentAt: 1000 }, 61_000)).toBe(10);
  });

  it('never goes below zero (clock skew)', () => {
    expect(targetPosition({ playing: true, position: 0.1, sentAt: 2000 }, 1000)).toBe(0);
  });

  it('a seek sent from France lands within the threshold in Taiwan, 300 ms later', () => {
    const sent = { playing: true, position: 95, sentAt: 50_000 };
    const now = 50_300;
    const target = targetPosition(sent, now);
    // The receiver still plays at 40 s: it must seek, and lands where the sender is now.
    expect(needsCorrection(40, target)).toBe(true);
    expect(Math.abs(target - 95.3)).toBeLessThan(1e-9);
  });
});

describe('needsCorrection', () => {
  it('corrects only beyond 1 s of drift, in either direction', () => {
    expect(needsCorrection(10, 11)).toBe(false);
    expect(needsCorrection(11, 10)).toBe(false);
    expect(needsCorrection(10, 11.001)).toBe(true);
    expect(needsCorrection(11.001, 10)).toBe(true);
    expect(needsCorrection(10, 10.25)).toBe(false);
  });

  it('takes a custom threshold', () => {
    expect(needsCorrection(10, 10.6, 0.5)).toBe(true);
    expect(needsCorrection(10, 10.4, 0.5)).toBe(false);
  });
});

const yt: MediaSource = { kind: 'youtube', videoId: 'dQw4w9WgXcQ' };
const other: MediaSource = { kind: 'youtube', videoId: 'aaaaaaaaaaa' };

describe('mediaReducer', () => {
  it('a local action bumps the lamport', () => {
    const s1 = mediaReducer(INITIAL_MEDIA_STATE, { type: 'local', next: { source: yt, playing: false, position: 0, sentAt: 100 } });
    expect(s1).toEqual({ source: yt, playing: false, position: 0, sentAt: 100, lamport: 1 });
    const s2 = mediaReducer(s1, { type: 'local', next: { source: yt, playing: true, position: 0, sentAt: 200 } });
    expect(s2.lamport).toBe(2);
    expect(s2.playing).toBe(true);
  });

  it('applies a remote state with a higher lamport', () => {
    const s: MediaState = { source: yt, playing: false, position: 3, sentAt: 100, lamport: 2 };
    const msg = { t: 'media-state' as const, source: yt, playing: true, position: 5, sentAt: 200, lamport: 3 };
    expect(mediaReducer(s, { type: 'remote', msg })).toEqual({ source: yt, playing: true, position: 5, sentAt: 200, lamport: 3 });
  });

  it('ignores a stale remote state (lower lamport), keeping the same object', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5 };
    const msg = { t: 'media-state' as const, source: other, playing: false, position: 0, sentAt: 999, lamport: 4 };
    expect(mediaReducer(s, { type: 'remote', msg })).toBe(s);
  });

  it('on equal lamports, the later sentAt wins', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5 };
    const later = { t: 'media-state' as const, source: yt, playing: false, position: 4, sentAt: 101, lamport: 5 };
    const earlier = { ...later, sentAt: 99 };
    const same = { ...later, sentAt: 100 };
    expect(mediaReducer(s, { type: 'remote', msg: later })).toEqual({ source: yt, playing: false, position: 4, sentAt: 101, lamport: 5 });
    expect(mediaReducer(s, { type: 'remote', msg: earlier })).toBe(s);
    expect(mediaReducer(s, { type: 'remote', msg: same })).toBe(s);
  });

  it('two people acting at once end in the same state', () => {
    const base: MediaState = { source: yt, playing: false, position: 0, sentAt: 0, lamport: 1 };
    const a = mediaReducer(base, { type: 'local', next: { source: yt, playing: true, position: 0, sentAt: 1000 } });
    const b = mediaReducer(base, { type: 'local', next: { source: yt, playing: false, position: 30, sentAt: 1005 } });
    const aMsg = { t: 'media-state' as const, ...a };
    const bMsg = { t: 'media-state' as const, ...b };
    expect(mediaReducer(a, { type: 'remote', msg: bMsg })).toEqual(mediaReducer(b, { type: 'remote', msg: aMsg }));
  });

  it('after adopting a remote state, the next local action wins over it', () => {
    const s = mediaReducer(INITIAL_MEDIA_STATE, { type: 'remote', msg: { t: 'media-state', source: yt, playing: true, position: 8, sentAt: 10, lamport: 7 } });
    const next = mediaReducer(s, { type: 'local', next: { source: yt, playing: false, position: 9, sentAt: 11 } });
    expect(next.lamport).toBe(8);
  });

  it('a late joiner (or a reload) adopts the current media and position', () => {
    const reply = { t: 'media-state' as const, source: yt, playing: true, position: 120, sentAt: 5000, lamport: 12 };
    const joined = mediaReducer(INITIAL_MEDIA_STATE, { type: 'remote', msg: reply });
    expect(joined).toEqual({ source: yt, playing: true, position: 120, sentAt: 5000, lamport: 12 });
    // 250 ms later the joiner's player is still at 0: it seeks to just past 120 s.
    expect(needsCorrection(0, targetPosition(joined, 5250))).toBe(true);
    expect(targetPosition(joined, 5250)).toBeCloseTo(120.25);
  });

  it('closing the media for both (source null) is a normal remote state', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5 };
    expect(mediaReducer(s, { type: 'remote', msg: { t: 'media-state', source: null, playing: false, position: 0, sentAt: 200, lamport: 6 } }).source).toBeNull();
  });
});
