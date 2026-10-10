import { describe, expect, it } from 'vitest';
import { followReducer, layoutPages, scrollForCenter, viewCenter, type FollowState } from './view';

describe('viewCenter / scrollForCenter', () => {
  it('round-trips between screen sizes', () => {
    const teacher = { scrollX: -100, scrollY: 50, zoom: 2, width: 1200, height: 800 };
    const c = viewCenter(teacher);
    expect(c).toEqual({ cx: 400, cy: 150 });
    const student = scrollForCenter(c, 2, { width: 800, height: 600 });
    expect(viewCenter({ ...student, zoom: 2, width: 800, height: 600 })).toEqual(c);
  });
});

describe('followReducer', () => {
  const start: FollowState = { following: true, lastApplied: null };

  it('stays following when the scroll is the one we applied', () => {
    let s = followReducer(start, { type: 'applied', scrollX: 10, scrollY: 20, zoom: 1 });
    s = followReducer(s, { type: 'scrolled', scrollX: 10.2, scrollY: 19.9, zoom: 1 });
    expect(s.following).toBe(true);
  });

  it('pauses when the student pans or zooms on their own', () => {
    let s = followReducer(start, { type: 'applied', scrollX: 10, scrollY: 20, zoom: 1 });
    s = followReducer(s, { type: 'scrolled', scrollX: 200, scrollY: 20, zoom: 1 });
    expect(s.following).toBe(false);
    s = followReducer(start, { type: 'applied', scrollX: 10, scrollY: 20, zoom: 1 });
    expect(followReducer(s, { type: 'scrolled', scrollX: 10, scrollY: 20, zoom: 1.5 }).following).toBe(false);
  });

  it('ignores teacher updates while paused, until Resume', () => {
    let s: FollowState = { following: false, lastApplied: null };
    s = followReducer(s, { type: 'applied', scrollX: 1, scrollY: 1, zoom: 1 });
    expect(s.following).toBe(false);
    expect(followReducer(s, { type: 'resume' }).following).toBe(true);
  });
});

describe('layoutPages', () => {
  it('scales pages to one width and stacks them with a gap', () => {
    const r = layoutPages([{ width: 600, height: 800 }, { width: 1200, height: 900 }], { x: 0, y: 0, width: 1000, gap: 80 });
    expect(r).toEqual([
      { x: 0, y: 0, width: 1000, height: 1333 },
      { x: 0, y: 1413, width: 1000, height: 750 },
    ]);
  });
});
