import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from './saveQueue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSaveQueue', () => {
  it('debounces: saves only the latest scene after the delay', async () => {
    const save = vi.fn(async () => {});
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 3000 });
    q.push({ n: 1 });
    q.push({ n: 2 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ n: 2 });
    q.dispose();
  });

  it('backs up and retries a failed save, warning after 3 failures', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline');
    });
    const backup = vi.fn();
    const onFailures = vi.fn();
    const q = createSaveQueue({ save, backup, onFailures, delayMs: 10, retryMs: 100 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(backup).toHaveBeenCalledWith({ n: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(3);
    expect(onFailures).toHaveBeenLastCalledWith(3);
    q.dispose();
  });

  it('stops retrying once a save succeeds', async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error('offline');
    });
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 10, retryMs: 100 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    fail = false;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    q.dispose();
  });

  it('flush saves immediately (End lesson)', async () => {
    const save = vi.fn(async () => {});
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 3000 });
    q.push({ n: 9 });
    await q.flush();
    expect(save).toHaveBeenCalledWith({ n: 9 });
    q.dispose();
  });
});

describe('createSaveQueue concurrency', () => {
  it('never overlaps saves: a push during an in-flight save is saved after it', async () => {
    let active = 0;
    let maxActive = 0;
    const seen: unknown[] = [];
    const save = vi.fn(async (scene: unknown) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(scene);
      await new Promise((r) => setTimeout(r, 500));
      active -= 1;
    });
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 10 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10); // first save now in flight
    q.push({ n: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    expect(maxActive).toBe(1);
    q.dispose();
  });

  it('flush while a retry is pending saves immediately and resolves true', async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error('offline');
    });
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 10, retryMs: 10000 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    fail = false;
    await expect(q.flush()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    q.dispose();
  });

  it('flush resolves false when the save fails', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline');
    });
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 3000 });
    q.push({ n: 1 });
    await expect(q.flush()).resolves.toBe(false);
    q.dispose();
  });

  it('dispose during an in-flight failing save stops all further saves', async () => {
    const save = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      throw new Error('offline');
    });
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 10, retryMs: 50 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    q.dispose();
    await vi.advanceTimersByTimeAsync(100000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('still retries when the backup itself throws', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline');
    });
    const backup = vi.fn(() => {
      throw new Error('quota');
    });
    const q = createSaveQueue({ save, backup, onFailures: vi.fn(), delayMs: 10, retryMs: 100 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    q.dispose();
  });
});
