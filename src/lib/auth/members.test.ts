import { describe, expect, it } from 'vitest';
import { isRole, normalizeEmail } from './members';

describe('normalizeEmail', () => {
  it('lowercases and trims so allowlist matching ignores case', () => {
    expect(normalizeEmail('  Huynh@Gmail.COM ')).toBe('huynh@gmail.com');
  });
});

describe('isRole', () => {
  it('accepts only teacher and student', () => {
    expect(isRole('teacher')).toBe(true);
    expect(isRole('student')).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
