import { describe, expect, it } from 'vitest';
import { formatElapsed, isOvertime } from './timer';

const S = 1000;
const M = 60 * S;
const H = 60 * M;

describe('formatElapsed', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7 * S)).toBe('0:07');
    expect(formatElapsed(45 * M + 12 * S)).toBe('45:12');
    expect(formatElapsed(59 * M + 59 * S)).toBe('59:59');
  });
  it('formats an hour or more as h:mm:ss', () => {
    expect(formatElapsed(H)).toBe('1:00:00');
    expect(formatElapsed(H + 5 * M + 3 * S)).toBe('1:05:03');
  });
  it('clamps negative input to 0:00', () => {
    expect(formatElapsed(-5000)).toBe('0:00');
  });
});

describe('isOvertime', () => {
  it('is false before 90 minutes and true from 90 minutes', () => {
    expect(isOvertime(89 * M + 59 * S)).toBe(false);
    expect(isOvertime(90 * M)).toBe(true);
  });
  it('honours a custom limit', () => {
    expect(isOvertime(60 * M, 60)).toBe(true);
  });
});
