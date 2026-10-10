import { describe, expect, it } from 'vitest';
import {
  applyRemoteStage,
  initialStage,
  localStageChange,
  resolveVisibleStage,
  shouldStopLocalShare,
  stageAfterLocalShareEnded,
  type StageState,
} from './stage';

describe('stage changes', () => {
  it('a local change bumps the counter and records who changed it', () => {
    expect(localStageChange(initialStage, 'screen', 'student')).toEqual({ stage: 'screen', lamport: 1, by: 'student' });
  });

  it('accepts a remote change with a higher counter', () => {
    const s: StageState = { stage: 'cameras', lamport: 2, by: 'teacher' };
    expect(applyRemoteStage(s, { stage: 'screen', lamport: 3, by: 'student' })).toEqual({ stage: 'screen', lamport: 3, by: 'student' });
  });

  it('ignores an older remote change and returns the same object', () => {
    const s: StageState = { stage: 'screen', lamport: 5, by: 'student' };
    expect(applyRemoteStage(s, { stage: 'cameras', lamport: 4, by: 'teacher' })).toBe(s);
  });

  it('both press at the same moment: both screens end on the teacher’s choice', () => {
    const start: StageState = { stage: 'cameras', lamport: 1, by: 'teacher' };
    const teacherLocal = localStageChange(start, 'board', 'teacher'); // lamport 2
    const studentLocal = localStageChange(start, 'screen', 'student'); // lamport 2
    const teacherFinal = applyRemoteStage(teacherLocal, { stage: 'screen', lamport: 2, by: 'student' });
    const studentFinal = applyRemoteStage(studentLocal, { stage: 'board', lamport: 2, by: 'teacher' });
    expect(teacherFinal.stage).toBe('board');
    expect(studentFinal.stage).toBe('board');
  });

  it('a late joiner adopts the current stage', () => {
    expect(applyRemoteStage(initialStage, { stage: 'screen', lamport: 7, by: 'teacher' }).stage).toBe('screen');
  });
});

describe('resolveVisibleStage', () => {
  const available = ['cameras', 'screen'] as const;

  it('falls back to cameras when the stage module is not built yet', () => {
    expect(resolveVisibleStage('board', { screenActive: false, available })).toBe('cameras');
  });

  it('falls back to cameras when the stage is screen but nobody is sharing', () => {
    expect(resolveVisibleStage('screen', { screenActive: false, available })).toBe('cameras');
    expect(resolveVisibleStage('screen', { screenActive: true, available })).toBe('screen');
  });
});

describe('screen share hand-over', () => {
  it('stops my share when the other person starts sharing', () => {
    expect(shouldStopLocalShare(true, true)).toBe(true);
    expect(shouldStopLocalShare(false, true)).toBe(false);
    expect(shouldStopLocalShare(true, false)).toBe(false);
  });

  it('keeps the stage on screen when my share ended because the other person took over', () => {
    expect(stageAfterLocalShareEnded('screen', true)).toBeNull();
  });

  it('returns to cameras when I stop sharing and nobody else shares', () => {
    expect(stageAfterLocalShareEnded('screen', false)).toBe('cameras');
  });

  it('leaves another stage alone', () => {
    expect(stageAfterLocalShareEnded('board', false)).toBeNull();
  });
});
