import { describe, expect, it } from 'vitest';
import { checkUpload } from '@/features/board/upload';
import { decodeBoard } from '@/features/board/protocol';
import { AUDIO_MAX_BYTES, AUDIO_MIMES, DOC_MAX_BYTES, IMAGE_MIMES } from './limits';

describe('limits (the one source for uploads, Drive and the board protocol)', () => {
  it('PDFs and images: 30 MB, for uploads and Drive alike', () => {
    expect(DOC_MAX_BYTES).toBe(30 * 1024 * 1024);
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf', size: DOC_MAX_BYTES }).ok).toBe(true);
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf', size: DOC_MAX_BYTES + 1 })).toEqual({ ok: false, reason: 'board.fileTooLarge' });
  });

  it('the image types are the same for uploads and board file messages', () => {
    for (const type of IMAGE_MIMES) {
      expect(checkUpload({ name: 'x', type, size: 1 })).toEqual({ ok: true, kind: 'image' });
      const msg = JSON.stringify({ v: 1, t: 'file', fileId: 'f', path: 'p', mime: type, width: 1, height: 1 });
      expect(decodeBoard(msg)).not.toBeNull();
    }
    expect(checkUpload({ name: 'x.gif', type: 'image/gif', size: 1 }).ok).toBe(false);
  });

  it('audio is limited to 50 MB, MP3/M4A/WAV/OGG only', () => {
    expect(AUDIO_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(AUDIO_MIMES.every((m) => m.startsWith('audio/'))).toBe(true);
  });
});
