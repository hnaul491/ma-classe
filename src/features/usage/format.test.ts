import { describe, expect, it } from 'vitest';
import type { UsageItem } from './estimate';
import { usageAmounts } from './format';

const item = (key: UsageItem['key'], used: number): UsageItem => ({ key, used, limit: 1, ratio: 0, level: 'ok' });
/** Intl puts no-break spaces (U+00A0, U+202F) between digit groups and before units. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('usageAmounts', () => {
  it('minutes, with the locale’s digit grouping', () => {
    expect(plain(usageAmounts(item('minutes', 1234), 'en'))).toBe('1,234 min / 5,000 min');
    expect(plain(usageAmounts(item('minutes', 1234), 'fr'))).toBe('1 234 min / 5 000 min');
  });
  it('video data in GB, Go in French', () => {
    expect(plain(usageAmounts(item('data', 1.23e9), 'en'))).toBe('1.2 GB / 50 GB');
    expect(plain(usageAmounts(item('data', 1.23e9), 'fr'))).toBe('1,2 Go / 50 Go');
  });
  it('storage in MB against the 1 GB limit, Mo and Go in French', () => {
    expect(plain(usageAmounts(item('storage', 12 * 1024 ** 2), 'en'))).toBe('12 MB / 1 GB');
    expect(plain(usageAmounts(item('storage', 12 * 1024 ** 2), 'fr'))).toBe('12 Mo / 1 Go');
  });
});
