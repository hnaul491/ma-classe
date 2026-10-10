import { describe, expect, it } from 'vitest';
import { isLocalSupabaseUrl } from './e2eGuard';

describe('isLocalSupabaseUrl', () => {
  it('accepts a Supabase CLI local stack', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true);
  });

  it('refuses a hosted project and garbage', () => {
    expect(isLocalSupabaseUrl('https://abcd.supabase.co')).toBe(false);
    expect(isLocalSupabaseUrl('https://localhost.evil.example')).toBe(false);
    expect(isLocalSupabaseUrl('not a url')).toBe(false);
    expect(isLocalSupabaseUrl('')).toBe(false);
  });
});
