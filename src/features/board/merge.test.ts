import { describe, expect, it } from 'vitest';
import { isMissingFunction, mergeSceneElements } from './merge';

const el = (id: string, version: number, versionNonce: number, extra: Record<string, unknown> = {}) => ({ id, version, versionNonce, ...extra });

describe('mergeSceneElements', () => {
  it('keeps the element with the higher version, from either side', () => {
    const stored = [el('a', 5, 1, { x: 'stored' }), el('b', 1, 1, { x: 'stored' })];
    const incoming = [el('a', 3, 1, { x: 'stale' }), el('b', 2, 1, { x: 'newer' })];
    expect(mergeSceneElements(stored, incoming)).toEqual([el('a', 5, 1, { x: 'stored' }), el('b', 2, 1, { x: 'newer' })]);
  });

  it('on a version tie keeps the lower versionNonce, like Excalidraw', () => {
    expect(mergeSceneElements([el('a', 4, 900)], [el('a', 4, 100)])).toEqual([el('a', 4, 100)]);
    expect(mergeSceneElements([el('a', 4, 100)], [el('a', 4, 900)])).toEqual([el('a', 4, 100)]);
  });

  it('on a full tie keeps the stored element', () => {
    expect(mergeSceneElements([el('a', 4, 100, { x: 'stored' })], [el('a', 4, 100, { x: 'incoming' })])).toEqual([el('a', 4, 100, { x: 'stored' })]);
  });

  it('keeps elements that exist on only one side: stored order first, then new ones', () => {
    const merged = mergeSceneElements([el('a', 1, 1), el('b', 1, 1)], [el('c', 1, 1), el('a', 2, 1)]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(merged[0].version).toBe(2);
  });

  it('keeps a newer deletion (a stale client cannot bring a deleted element back)', () => {
    const stored = [el('a', 6, 1, { isDeleted: true })];
    expect(mergeSceneElements(stored, [el('a', 5, 1, { isDeleted: false })])).toEqual(stored);
  });

  it('handles empty sides and a duplicate id on one side', () => {
    expect(mergeSceneElements([], [])).toEqual([]);
    expect(mergeSceneElements([], [el('a', 1, 1)])).toEqual([el('a', 1, 1)]);
    expect(mergeSceneElements([el('a', 1, 5), el('a', 3, 5)], [])).toEqual([el('a', 3, 5)]);
  });

  it('is symmetric in which element wins', () => {
    const a = [el('a', 2, 7), el('b', 3, 3)];
    const b = [el('a', 2, 4), el('b', 1, 1)];
    const ab = mergeSceneElements(a, b);
    const ba = mergeSceneElements(b, a);
    expect(new Set(ab)).toEqual(new Set(ba));
  });
});

describe('isMissingFunction', () => {
  it('recognises a missing merge_board_save (before migration 0006)', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true); // PostgREST: not in the schema cache
    expect(isMissingFunction({ code: '42883' })).toBe(true); // Postgres: undefined function
    expect(isMissingFunction({ code: '42501' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
