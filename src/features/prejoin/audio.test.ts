import { describe, expect, it } from 'vitest';
import { rmsLevel } from './audio';

describe('rmsLevel', () => {
  it('is 0 for silence (all samples at the 128 midpoint)', () => {
    expect(rmsLevel(new Uint8Array(256).fill(128))).toBe(0);
  });

  it('is close to 1 for a full-scale square wave', () => {
    const loud = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 0 : 255));
    expect(rmsLevel(loud)).toBeCloseTo(1, 1);
  });

  it('is 0 for an empty buffer', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0);
  });
});
