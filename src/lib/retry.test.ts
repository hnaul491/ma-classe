import { describe, expect, it, vi } from 'vitest';
import { FatalError, withRetry } from './retry';

const noSleep = vi.fn(async () => {});

describe('withRetry', () => {
  it('retries until success with growing delays', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('down');
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 500, sleep },
    );
    expect(result).toBe('ok');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it('does not retry a FatalError', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new FatalError('This lesson has ended.');
        },
        { attempts: 3, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('This lesson has ended.');
    expect(calls).toBe(1);
  });

  it('throws the last error after the final attempt', async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error('still down');
        },
        { attempts: 2, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('still down');
  });
});
