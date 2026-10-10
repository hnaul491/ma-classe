import { describe, expect, it } from 'vitest';
import { hasLiveElements, reviewTarget } from './target';

const ID = '11111111-1111-4111-8111-111111111111';

describe('reviewTarget', () => {
  it('a malformed id or an unknown lesson is not found', () => {
    expect(reviewTarget('nope', null)).toBe('not-found');
    expect(reviewTarget(ID, null)).toBe('not-found');
  });
  it('a live lesson goes to the room', () => {
    expect(reviewTarget(ID, { status: 'live' })).toBe('live');
  });
  it('an ended lesson is shown', () => {
    expect(reviewTarget(ID, { status: 'ended' })).toBe('show');
  });
});

describe('hasLiveElements', () => {
  it('an empty scene, or one with only erased elements, is empty', () => {
    expect(hasLiveElements([])).toBe(false);
    expect(hasLiveElements([{ isDeleted: true }, { isDeleted: true }])).toBe(false);
  });
  it('one element that was not erased is enough', () => {
    expect(hasLiveElements([{ isDeleted: true }, { isDeleted: false }])).toBe(true);
    expect(hasLiveElements([{}])).toBe(true);
  });
});
