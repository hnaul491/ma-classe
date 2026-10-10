import { describe, expect, it } from 'vitest';
import { estimateUsage, FREE_LIMITS, monthStart } from './estimate';

const now = new Date('2026-10-20T12:00:00.000Z');
const get = (u: ReturnType<typeof estimateUsage>, k: 'minutes' | 'data' | 'storage') => u.items.find((i) => i.key === k)!;

describe('monthStart', () => {
  it('is the first instant of the UTC month', () => {
    expect(monthStart(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('estimateUsage', () => {
  it('counts lesson minutes × 2 participants', () => {
    const u = estimateUsage({ lessons: [{ started_at: '2026-10-05T10:00:00.000Z', ended_at: '2026-10-05T11:30:00.000Z' }], fileBytes: [], now });
    expect(get(u, 'minutes').used).toBe(180);
    expect(get(u, 'minutes').limit).toBe(FREE_LIMITS.participantMinutes);
  });
  it('estimates data at 0.8 Mbit/s per participant-minute', () => {
    const u = estimateUsage({ lessons: [{ started_at: '2026-10-05T10:00:00.000Z', ended_at: '2026-10-05T11:30:00.000Z' }], fileBytes: [], now });
    expect(get(u, 'data').used).toBe(180 * 60 * 0.1e6);
  });
  it('counts only the part of a lesson inside this month', () => {
    const u = estimateUsage({ lessons: [{ started_at: '2026-09-30T23:30:00.000Z', ended_at: '2026-10-01T00:30:00.000Z' }], fileBytes: [], now });
    expect(get(u, 'minutes').used).toBe(60);
  });
  it('a lesson still live counts up to now, but no lesson counts past 4 hours', () => {
    const live = estimateUsage({ lessons: [{ started_at: '2026-10-20T11:00:00.000Z', ended_at: null }], fileBytes: [], now });
    expect(get(live, 'minutes').used).toBe(120);
    const forgotten = estimateUsage({ lessons: [{ started_at: '2026-10-02T08:00:00.000Z', ended_at: null }], fileBytes: [], now });
    expect(get(forgotten, 'minutes').used).toBe(480);
  });
  it('ignores lessons that ended before this month or have nonsense times', () => {
    const u = estimateUsage({
      lessons: [
        { started_at: '2026-09-02T10:00:00.000Z', ended_at: '2026-09-02T11:00:00.000Z' },
        { started_at: 'bad', ended_at: null },
        { started_at: '2026-10-05T11:00:00.000Z', ended_at: '2026-10-05T10:00:00.000Z' },
      ],
      fileBytes: [],
      now,
    });
    expect(get(u, 'minutes').used).toBe(0);
  });
  it('storage is the sum of file sizes', () => {
    expect(get(estimateUsage({ lessons: [], fileBytes: [100, 250], now }), 'storage').used).toBe(350);
  });
  it('warns at 70% and flags over 100%', () => {
    const at70 = estimateUsage({ lessons: [], fileBytes: [0.71 * FREE_LIMITS.storageBytes], now });
    expect(get(at70, 'storage').level).toBe('warn');
    expect(at70.warn).toBe(true);
    const over = estimateUsage({ lessons: [], fileBytes: [1.2 * FREE_LIMITS.storageBytes], now });
    expect(get(over, 'storage').level).toBe('over');
    expect(get(over, 'storage').ratio).toBeCloseTo(1.2);
    expect(estimateUsage({ lessons: [], fileBytes: [10], now }).warn).toBe(false);
  });
});
