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
    const s1 = mediaReducer(INITIAL_MEDIA_STATE, { type: 'local', next: { source: yt, playing: false, position: 0, sentAt: 100, by: 'teacher' } });
    expect(s1).toEqual({ source: yt, playing: false, position: 0, sentAt: 100, lamport: 1, by: 'teacher' });
    const s2 = mediaReducer(s1, { type: 'local', next: { source: yt, playing: true, position: 0, sentAt: 200, by: 'student' } });
    expect(s2.lamport).toBe(2);
    expect(s2.playing).toBe(true);
    expect(s2.by).toBe('student');
  });

  it('applies a remote state with a higher lamport', () => {
    const s: MediaState = { source: yt, playing: false, position: 3, sentAt: 100, lamport: 2, by: 'teacher' };
    const msg = { t: 'media-state' as const, source: yt, playing: true, position: 5, sentAt: 200, lamport: 3, by: 'student' as const };
    expect(mediaReducer(s, { type: 'remote', msg })).toEqual({ source: yt, playing: true, position: 5, sentAt: 200, lamport: 3, by: 'student' });
  });

  it('ignores a stale remote state (lower lamport), keeping the same object', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5, by: 'student' };
    const msg = { t: 'media-state' as const, source: other, playing: false, position: 0, sentAt: 999, lamport: 4, by: 'teacher' as const };
    expect(mediaReducer(s, { type: 'remote', msg })).toBe(s);
  });

  it('on equal lamports the teacher wins, whatever the clocks say', () => {
    const studentState: MediaState = { source: yt, playing: true, position: 3, sentAt: 900, lamport: 5, by: 'student' };
    const teacherMsg = { t: 'media-state' as const, source: yt, playing: false, position: 4, sentAt: 100, lamport: 5, by: 'teacher' as const };
    expect(mediaReducer(studentState, { type: 'remote', msg: teacherMsg })).toEqual({ source: yt, playing: false, position: 4, sentAt: 100, lamport: 5, by: 'teacher' });
    const teacherState: MediaState = { source: yt, playing: false, position: 4, sentAt: 100, lamport: 5, by: 'teacher' };
    const studentMsg = { t: 'media-state' as const, source: yt, playing: true, position: 3, sentAt: 900, lamport: 5, by: 'student' as const };
    expect(mediaReducer(teacherState, { type: 'remote', msg: studentMsg })).toBe(teacherState);
  });

  it('on equal lamports from the same person (a heartbeat), the later sentAt wins', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5, by: 'teacher' };
    const later = { t: 'media-state' as const, source: yt, playing: true, position: 8, sentAt: 5100, lamport: 5, by: 'teacher' as const };
    expect(mediaReducer(s, { type: 'remote', msg: later })).toEqual({ source: yt, playing: true, position: 8, sentAt: 5100, lamport: 5, by: 'teacher' });
    expect(mediaReducer(s, { type: 'remote', msg: { ...later, sentAt: 99 } })).toBe(s);
    expect(mediaReducer(s, { type: 'remote', msg: { ...later, sentAt: 100 } })).toBe(s);
  });

  it('two people acting at once end in the same state: the teacher’s', () => {
    const base: MediaState = { source: yt, playing: false, position: 0, sentAt: 0, lamport: 1, by: 'teacher' };
    const a = mediaReducer(base, { type: 'local', next: { source: yt, playing: true, position: 0, sentAt: 1000, by: 'teacher' } });
    const b = mediaReducer(base, { type: 'local', next: { source: yt, playing: false, position: 30, sentAt: 1005, by: 'student' } });
    const aMsg = { t: 'media-state' as const, ...a, by: 'teacher' as const };
    const bMsg = { t: 'media-state' as const, ...b, by: 'student' as const };
    const atA = mediaReducer(a, { type: 'remote', msg: bMsg });
    const atB = mediaReducer(b, { type: 'remote', msg: aMsg });
    expect(atA).toEqual(atB);
    expect(atA.by).toBe('teacher');
    expect(atA.playing).toBe(true);
  });

  it('after adopting a remote state, the next local action wins over it', () => {
    const s = mediaReducer(INITIAL_MEDIA_STATE, {
      type: 'remote',
      msg: { t: 'media-state', source: yt, playing: true, position: 8, sentAt: 10, lamport: 7, by: 'teacher' },
    });
    const next = mediaReducer(s, { type: 'local', next: { source: yt, playing: false, position: 9, sentAt: 11, by: 'student' } });
    expect(next.lamport).toBe(8);
  });

  it('a late joiner (or a reload) adopts the current media and position', () => {
    const reply = { t: 'media-state' as const, source: yt, playing: true, position: 120, sentAt: 5000, lamport: 12, by: 'student' as const };
    const joined = mediaReducer(INITIAL_MEDIA_STATE, { type: 'remote', msg: reply });
    expect(joined).toEqual({ source: yt, playing: true, position: 120, sentAt: 5000, lamport: 12, by: 'student' });
    // 250 ms later the joiner's player is still at 0: it seeks to just past 120 s.
    expect(needsCorrection(0, targetPosition(joined, 5250))).toBe(true);
    expect(targetPosition(joined, 5250)).toBeCloseTo(120.25);
  });

  it('closing the media for both (source null) is a normal remote state', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5, by: 'teacher' };
    const msg = { t: 'media-state' as const, source: null, playing: false, position: 0, sentAt: 200, lamport: 6, by: 'student' as const };
    expect(mediaReducer(s, { type: 'remote', msg }).source).toBeNull();
  });
});
