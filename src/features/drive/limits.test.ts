import { describe, expect, it } from 'vitest';
import { MAX_BYTES } from '@/features/board/upload';
import { AUDIO_MAX_BYTES, AUDIO_MIMES, DOC_MAX_BYTES } from './limits';

describe('limits', () => {
  it('PDFs and images from Drive follow the upload limit (30 MB)', () => {
    expect(DOC_MAX_BYTES).toBe(30 * 1024 * 1024);
    expect(DOC_MAX_BYTES).toBe(MAX_BYTES);
  });

  it('audio is limited to 50 MB, MP3/M4A/WAV/OGG only', () => {
    expect(AUDIO_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(AUDIO_MIMES.every((m) => m.startsWith('audio/'))).toBe(true);
  });
});
