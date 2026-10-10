import { describe, expect, it, vi } from 'vitest';

// The pure Drive and media modules must load without Supabase or the board upload code.
vi.mock('@/lib/supabase/client', () => {
  throw new Error('a pure module imported the Supabase client');
});
vi.mock('@/features/board/upload', () => {
  throw new Error('a pure module imported board/upload');
});

describe('pure modules', () => {
  it('classify, limits, the media protocol, sync and playback import neither Supabase nor board/upload', async () => {
    await expect(import('@/lib/limits')).resolves.toBeDefined();
    await expect(import('./classify')).resolves.toBeDefined();
    await expect(import('@/features/media/protocol')).resolves.toBeDefined();
    await expect(import('@/features/media/sync')).resolves.toBeDefined();
    await expect(import('@/features/media/playback')).resolves.toBeDefined();
  });
});
