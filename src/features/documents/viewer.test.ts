import { describe, expect, it } from 'vitest';
import { currentPageFrom } from './viewer';

describe('currentPageFrom', () => {
  it('is the page crossing the band, preferring the larger overlap', () => {
    expect(currentPageFrom([{ index: 2, isIntersecting: true, intersectionRatio: 0.1 }])).toBe(2);
    expect(
      currentPageFrom([
        { index: 1, isIntersecting: true, intersectionRatio: 0.2 },
        { index: 2, isIntersecting: true, intersectionRatio: 0.6 },
      ]),
    ).toBe(2);
  });

  it('ignores pages leaving the band', () => {
    expect(
      currentPageFrom([
        { index: 0, isIntersecting: false, intersectionRatio: 0 },
        { index: 1, isIntersecting: true, intersectionRatio: 0.05 },
      ]),
    ).toBe(1);
    expect(currentPageFrom([{ index: 0, isIntersecting: false, intersectionRatio: 0 }])).toBeNull();
    expect(currentPageFrom([])).toBeNull();
  });
});
