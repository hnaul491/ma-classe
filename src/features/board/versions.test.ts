import { describe, expect, it } from 'vitest';
import { changedElements, markKnown, type KnownVersions } from './versions';

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
