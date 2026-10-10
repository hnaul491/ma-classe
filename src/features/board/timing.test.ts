import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebounce, createThrottle } from './timing';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createDebounce (with maxWait)', () => {
  it('runs once after the calls stop', () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 50, 150);
    d.call();
    vi.advanceTimersByTime(30);
    d.call();
    vi.advanceTimersByTime(49);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still runs every maxWait while calls keep coming (strokes stream while drawing)', () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 50, 150);
    for (let t = 0; t < 400; t += 20) {
      d.call();
      vi.advanceTimersByTime(20);
    }
    // 400 ms of calls every 20 ms: runs at ~150 ms and ~300 ms.
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(3); // trailing run once the calls stop
  });

  it('flush runs a pending call now, and only once', () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 50, 150);
    d.flush();
    expect(fn).not.toHaveBeenCalled(); // nothing pending
    d.call();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a pending call', () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 50, 150);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('createThrottle (leading + trailing)', () => {
  it('sends the first call at once and the last call when the window ends', () => {
    const fn = vi.fn();
    const th = createThrottle<number>(fn, 100);
    th.call(1);
    th.call(2);
    th.call(3);
    expect(fn.mock.calls).toEqual([[1, 'leading']]);
    vi.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([
      [1, 'leading'],
      [3, 'trailing'],
    ]);
  });

  it('has no trailing send for a lone call unless alwaysTrailing is set', () => {
    const fn = vi.fn();
    const th = createThrottle<number>(fn, 100);
    th.call(1);
    vi.advanceTimersByTime(300);
    expect(fn.mock.calls).toEqual([[1, 'leading']]);

    const always = vi.fn();
    const th2 = createThrottle<number>(always, 100, { alwaysTrailing: true });
    th2.call(7);
    vi.advanceTimersByTime(100);
    expect(always.mock.calls).toEqual([
      [7, 'leading'],
      [7, 'trailing'], // the final position is always re-sent (reliably, by the caller)
    ]);
  });

  it('calls after the window lead again', () => {
    const fn = vi.fn();
    const th = createThrottle<number>(fn, 100);
    th.call(1);
    vi.advanceTimersByTime(150);
    th.call(2);
    expect(fn.mock.calls).toEqual([
      [1, 'leading'],
      [2, 'leading'],
    ]);
  });

  it('now() sends at once and drops the queued trailing call', () => {
    const fn = vi.fn();
    const th = createThrottle<string>(fn, 100);
    th.call('move1');
    th.call('move2');
    th.now('button');
    vi.advanceTimersByTime(300);
    expect(fn.mock.calls).toEqual([
      ['move1', 'leading'],
      ['button', 'now'],
    ]);
  });

  it('cancel drops the trailing call', () => {
    const fn = vi.fn();
    const th = createThrottle<number>(fn, 100);
    th.call(1);
    th.call(2);
    th.cancel();
    vi.advanceTimersByTime(300);
    expect(fn.mock.calls).toEqual([[1, 'leading']]);
  });
});
