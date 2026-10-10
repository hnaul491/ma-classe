import { describe, expect, it } from 'vitest';
import { countPageFrames, followReducer, layoutPages, sceneBottom, scrollForCenter, viewCenter, type FollowState } from './view';

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

describe('countPageFrames', () => {
  it('counts only live frames named like a page', () => {
    const frames = [
      { type: 'frame', name: 'Page 1' },
      { type: 'frame', name: 'Page 2', isDeleted: true },
      { type: 'frame', name: 'My notes' },
      { type: 'frame', name: null },
      { type: 'rectangle', name: 'Page 9' },
      { type: 'frame', name: 'Page 3' },
      { type: 'frame', name: 'Page 3 copy' },
    ];
    expect(countPageFrames(frames, 'Page {n}')).toBe(2);
  });

  it('escapes the template', () => {
    expect(countPageFrames([{ type: 'frame', name: 'P.1' }, { type: 'frame', name: 'Px1' }], 'P.{n}')).toBe(1);
  });
});

describe('sceneBottom', () => {
  it('is null for an empty scene and ignores deleted elements', () => {
    expect(sceneBottom([])).toBeNull();
    expect(sceneBottom([{ y: 0, height: 900, isDeleted: true }])).toBeNull();
  });

  it('finds the lowest edge, even when everything is above zero', () => {
    expect(sceneBottom([{ y: -500, height: 100 }, { y: -300, height: 50 }])).toBe(-250);
    expect(sceneBottom([{ y: 10, height: 100 }, { y: 50, height: 10 }])).toBe(110);
  });
});
