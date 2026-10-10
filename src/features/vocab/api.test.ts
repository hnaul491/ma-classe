import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabase: () => ({}) }));

import { vocabErrorKey } from './api';

describe('vocabErrorKey', () => {
  it('a missing table means migration 0007 has not run', () => {
    expect(vocabErrorKey({ code: '42P01' })).toBe('vocab.notReady');
    expect(vocabErrorKey({ code: 'PGRST205' })).toBe('vocab.notReady');
  });
  it('a refused write is a permission problem', () => {
    expect(vocabErrorKey({ code: '42501' })).toBe('vocab.notAllowed');
    expect(vocabErrorKey({ code: 'PGRST301' })).toBe('vocab.notAllowed');
  });
  it('anything else, or no error object, is a failed save', () => {
    expect(vocabErrorKey({ code: '23514' })).toBe('vocab.saveFailed');
    expect(vocabErrorKey(null)).toBe('vocab.saveFailed');
  });
});
