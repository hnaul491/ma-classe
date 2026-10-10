import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRetryDelay, withTimeout } from './retry';

describe('loadRetryDelay', () => {
  it('backs off 5 s, 10 s, 20 s, then every 30 s', () => {
    expect([0, 1, 2, 3, 4, 50].map(loadRetryDelay)).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
  });

  it('treats a bad attempt number as the first one', () => {
    expect(loadRetryDelay(-1)).toBe(5000);
    expect(loadRetryDelay(Number.NaN)).toBe(5000);
  });
});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(true), 4000, false)).resolves.toBe(true);
  });

  it('resolves with the fallback when the promise takes too long', async () => {
    const result = withTimeout(new Promise<boolean>(() => {}), 4000, false);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(result).resolves.toBe(false);
  });

  it('resolves with the fallback when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 4000, false)).resolves.toBe(false);
  });
});
