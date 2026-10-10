import { describe, expect, it } from 'vitest';
import type { MediaSource } from './protocol';
import { INITIAL_MEDIA_STATE, mediaReducer, type MediaState, needsCorrection, receiveState, targetPosition } from './sync';

describe('targetPosition', () => {
  it('adds the time since sending while playing (250 ms of latency)', () => {
    expect(targetPosition({ playing: true, position: 10, sentAt: 1000 }, 1250)).toBeCloseTo(10.25);
  });

  it('keeps the position while paused', () => {
    expect(targetPosition({ playing: false, position: 10, sentAt: 1000 }, 61_000)).toBe(10);
  });

  it('a receiver clock behind the sender never moves the target before the reported position', () => {
    expect(targetPosition({ playing: true, position: 0.1, sentAt: 2000 }, 1000)).toBe(0.1);
  });

  it('clock skew cannot trap a player near 0: the reported position is a floor', () => {
    // The receiver's clock is 30 s behind: every heartbeat looks like it comes from the future.
    const heartbeat = { playing: true, position: 100, sentAt: 1_000_000 };
    const now = 1_000_000 - 30_000;
    expect(targetPosition(heartbeat, now)).toBe(100);
    expect(needsCorrection(100.4, targetPosition(heartbeat, now))).toBe(false);
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

describe('mediaReducer with self (who I am)', () => {
  it('a reply about my own last action, at my lamport, never wins on the other person’s clock', () => {
    const mine: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5, by: 'student' };
    // The teacher's clock is ahead: its reply about my state has a later sentAt.
    const reply = { t: 'media-state' as const, source: yt, playing: true, position: 2, sentAt: 9_999, lamport: 5, by: 'student' as const };
    expect(mediaReducer(mine, { type: 'remote', msg: reply, self: 'student' })).toBe(mine);
  });

  it('still adopts my own state after a reload (my lamport is behind)', () => {
    const reply = { t: 'media-state' as const, source: yt, playing: true, position: 2, sentAt: 9_999, lamport: 5, by: 'student' as const };
    expect(mediaReducer(INITIAL_MEDIA_STATE, { type: 'remote', msg: reply, self: 'student' }).lamport).toBe(5);
  });

  it('still orders the other person’s heartbeats by sentAt', () => {
    const s: MediaState = { source: yt, playing: true, position: 3, sentAt: 100, lamport: 5, by: 'teacher' };
    const beat = { t: 'media-state' as const, source: yt, playing: true, position: 8, sentAt: 5100, lamport: 5, by: 'teacher' as const };
    expect(mediaReducer(s, { type: 'remote', msg: beat, self: 'student' }).position).toBe(8);
  });
});

describe('receiveState', () => {
  const mine: MediaState = { source: yt, playing: true, position: 30, sentAt: 500, lamport: 6, by: 'teacher' };
  type StateMsg = Extract<import('./protocol').MediaMessage, { t: 'media-state' }>;
  const msg = (o: Partial<MediaState>): StateMsg =>
    ({ t: 'media-state', source: yt, playing: false, position: 0, sentAt: 900, lamport: 6, by: 'teacher', ...o }) as StateMsg;

  it('adopts a newer state, without answering', () => {
    const r = receiveState(mine, msg({ lamport: 7, by: 'student' }), 'teacher');
    expect(r.next.lamport).toBe(7);
    expect(r.answer).toBe(false);
  });

  it('answers a stale state (lower lamport) with mine, keeping my counter at max(local, remote)', () => {
    const r = receiveState(mine, msg({ lamport: 2, by: 'student' }), 'teacher');
    expect(r.next).toBe(mine);
    expect(r.next.lamport).toBe(Math.max(6, 2));
    expect(r.answer).toBe(true);
  });

  it('answers a state that lost the tie-break (the teacher’s state wins at an equal lamport)', () => {
    const r = receiveState(mine, msg({ lamport: 6, by: 'student' }), 'teacher');
    expect(r.next).toBe(mine);
    expect(r.answer).toBe(true);
  });

  it('never answers an equal state, nor my own state sent back at my lamport (no ping-pong)', () => {
    expect(receiveState(mine, msg({ ...mine }), 'teacher').answer).toBe(false);
    expect(receiveState(mine, msg({ ...mine, sentAt: 99_999 }), 'teacher').answer).toBe(false);
    // An older heartbeat from the same person: not a conflict either.
    const theirs: MediaState = { ...mine, by: 'student' };
    expect(receiveState(theirs, msg({ ...theirs, sentAt: 1 }), 'teacher').answer).toBe(false);
  });

  it('converges after a reload where the joiner acted early: one answer, then no more', () => {
    // The student reloaded and pressed play at lamport 1; the teacher is at lamport 6.
    const early = msg({ lamport: 1, by: 'student', playing: true, position: 0 });
    const atTeacher = receiveState(mine, early, 'teacher');
    expect(atTeacher.answer).toBe(true);
    const answer = { t: 'media-state' as const, ...atTeacher.next, by: 'teacher' as const };
    const student: MediaState = { source: yt, playing: true, position: 0, sentAt: 900, lamport: 1, by: 'student' };
    const atStudent = receiveState(student, answer, 'student');
    expect(atStudent.next).toEqual(mine);
    expect(atStudent.answer).toBe(false);
  });
});
