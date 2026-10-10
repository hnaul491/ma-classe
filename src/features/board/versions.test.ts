import { describe, expect, it } from 'vitest';
import { adoptedElements, changedElements, markKnown, type KnownVersions } from './versions';

const v = (id: string, version: number) => ({ id, version, versionNonce: 1 });

describe('changedElements / markKnown', () => {
  it('reports only elements whose version is new to us', () => {
    const known: KnownVersions = new Map([['a', 1]]);
    expect(changedElements(known, [v('a', 1), v('b', 1), v('a', 2)].slice(0, 2))).toEqual([v('b', 1)]);
    expect(changedElements(known, [v('a', 2)])).toEqual([v('a', 2)]);
  });

  it('does not echo a remote change back after it was applied', () => {
    const known: KnownVersions = new Map();
    const remote = [v('x', 5)];
    markKnown(known, remote); // applied from the peer
    expect(changedElements(known, remote)).toEqual([]); // onChange fires with the same elements
  });

  it('never lowers a known version', () => {
    const known: KnownVersions = new Map([['a', 4]]);
    markKnown(known, [v('a', 2)]);
    expect(known.get('a')).toBe(4);
  });
});

describe('adoptedElements', () => {
  const e = (id: string, version: number, versionNonce: number) => ({ id, version, versionNonce });

  it('keeps only remote elements that won the merge', () => {
    const remote = [e('a', 2, 5), e('b', 3, 1), e('c', 1, 1)];
    const merged = [e('a', 2, 5), e('b', 4, 8), e('x', 1, 1)]; // b: local is newer; c: dropped
    expect(adoptedElements(merged, remote)).toEqual([e('a', 2, 5)]);
  });

  it('treats a same-version tie lost on versionNonce as not adopted', () => {
    expect(adoptedElements([e('a', 2, 1)], [e('a', 2, 9)])).toEqual([]);
  });
});
