import { describe, expect, it } from 'vitest';
import { minutesBetween } from './duration';

describe('minutesBetween', () => {
  it('is the whole minutes between start and end, rounded', () => {
    expect(minutesBetween('2026-10-05T10:00:00.000Z', '2026-10-05T11:30:00.000Z')).toBe(90);
    expect(minutesBetween('2026-10-05T10:00:00.000Z', '2026-10-05T10:00:31.000Z')).toBe(1);
    expect(minutesBetween('2026-10-05T10:00:00.000Z', '2026-10-05T10:00:29.000Z')).toBe(0);
  });
  it('is null while the lesson has no end', () => {
    expect(minutesBetween('2026-10-05T10:00:00.000Z', null)).toBeNull();
  });
});
