import { describe, expect, it } from 'vitest';
import { checkUpload, isFilePathFor, isLessonPath, MAX_BYTES, pdfPagesError } from './upload';

describe('checkUpload', () => {
  it('accepts PDFs and PNG/JPG/WebP images', () => {
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toEqual({ ok: true, kind: 'pdf' });
    expect(checkUpload({ name: 'b.png', type: 'image/png', size: 10 })).toEqual({ ok: true, kind: 'image' });
    expect(checkUpload({ name: 'c.jpg', type: 'image/jpeg', size: 10 })).toEqual({ ok: true, kind: 'image' });
    expect(checkUpload({ name: 'd.webp', type: 'image/webp', size: 10 })).toEqual({ ok: true, kind: 'image' });
  });

  it('trusts the .pdf extension when the browser gives no type', () => {
    expect(checkUpload({ name: 'Leçon.PDF', type: '', size: 10 })).toEqual({ ok: true, kind: 'pdf' });
  });

  it('rejects other files and anything over 30 MB, before uploading', () => {
    expect(checkUpload({ name: 'x.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10 })).toEqual({ ok: false, reason: 'board.unsupported' });
    expect(checkUpload({ name: 'big.pdf', type: 'application/pdf', size: MAX_BYTES + 1 })).toEqual({ ok: false, reason: 'board.fileTooLarge' });
  });
});

describe('pdfPagesError', () => {
  it('allows up to 50 pages', () => {
    expect(pdfPagesError(50)).toBeNull();
    expect(pdfPagesError(51)).toBe('board.tooManyPages');
  });
});

describe('isLessonPath', () => {
  it('accepts only files inside this lesson folder', () => {
    expect(isLessonPath('L1', 'L1/abc.webp')).toBe(true);
    expect(isLessonPath('L1', 'L2/abc.webp')).toBe(false);
    expect(isLessonPath('L1', 'L1abc.webp')).toBe(false);
    expect(isLessonPath('L1', 'L1/../L2/abc.webp')).toBe(false);
    expect(isLessonPath('L1', 'L1/')).toBe(false);
  });
});

describe('isFilePathFor', () => {
  it('accepts the path an upload gives this file, in any lesson folder', () => {
    expect(isFilePathFor('F1', 'L1/F1.webp')).toBe(true);
    expect(isFilePathFor('F1', 'L2/F1.webp')).toBe(true);
  });

  it('rejects other files, nested or relative paths', () => {
    expect(isFilePathFor('F1', 'L1/F2.webp')).toBe(false);
    expect(isFilePathFor('F1', 'F1.webp')).toBe(false);
    expect(isFilePathFor('F1', '/F1.webp')).toBe(false);
    expect(isFilePathFor('F1', '../F1.webp')).toBe(false);
    expect(isFilePathFor('F1', 'L1/x/F1.webp')).toBe(false);
    expect(isFilePathFor('F1', 'L1/F1.png')).toBe(false);
  });
});
