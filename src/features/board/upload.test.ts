import { describe, expect, it } from 'vitest';
import { DOC_MAX_BYTES } from '@/lib/limits';
import { checkUpload, imageMime, isFilePathFor, isLessonPath, pdfPagesError, shouldRetryWithoutDocumentColumns } from './upload';

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
    expect(checkUpload({ name: 'big.pdf', type: 'application/pdf', size: DOC_MAX_BYTES + 1 })).toEqual({ ok: false, reason: 'board.fileTooLarge' });
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

const F1 = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const F2 = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('isFilePathFor', () => {
  it('accepts the path an upload gives this file, in any lesson folder', () => {
    expect(isFilePathFor(F1, `L1/${F1}.webp`)).toBe(true);
    expect(isFilePathFor(F1, `L2/${F1}.webp`)).toBe(true);
  });

  it('rejects other files, nested or relative paths', () => {
    expect(isFilePathFor(F1, `L1/${F2}.webp`)).toBe(false);
    expect(isFilePathFor(F1, `${F1}.webp`)).toBe(false);
    expect(isFilePathFor(F1, `/${F1}.webp`)).toBe(false);
    expect(isFilePathFor(F1, `../${F1}.webp`)).toBe(false);
    expect(isFilePathFor(F1, `L1/x/${F1}.webp`)).toBe(false);
    expect(isFilePathFor(F1, `L1/${F1}.png`)).toBe(false);
  });

  it('requires a uuid file id (Excalidraw SHA-1 ids are never stored)', () => {
    expect(isFilePathFor('F1', 'L1/F1.webp')).toBe(false);
    expect(isFilePathFor('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3', 'L1/a94a8fe5ccb19ba61c4c0873d391e987982fbbd3.webp')).toBe(false);
  });
});

describe('shouldRetryWithoutDocumentColumns', () => {
  it('retries when the document columns do not exist yet (migration 0004 not run)', () => {
    expect(shouldRetryWithoutDocumentColumns({ code: 'PGRST204' })).toBe(true);
    expect(shouldRetryWithoutDocumentColumns({ code: '42703' })).toBe(true);
  });

  it('does not retry other errors or no error', () => {
    expect(shouldRetryWithoutDocumentColumns({ code: '42501' })).toBe(false);
    expect(shouldRetryWithoutDocumentColumns({ code: '23505' })).toBe(false);
    expect(shouldRetryWithoutDocumentColumns(null)).toBe(false);
    expect(shouldRetryWithoutDocumentColumns({})).toBe(false);
  });
});

describe('imageMime', () => {
  it('keeps an allowed image type (Safari encodes PNG when asked for WebP)', () => {
    expect(imageMime('image/png')).toBe('image/png');
    expect(imageMime('image/webp')).toBe('image/webp');
    expect(imageMime('image/jpeg')).toBe('image/jpeg');
  });

  it('falls back for anything outside the bucket allow-list', () => {
    expect(imageMime('')).toBe('image/webp');
    expect(imageMime('image/svg+xml')).toBe('image/webp');
    expect(imageMime(undefined, 'image/png')).toBe('image/png');
    expect(imageMime('application/octet-stream', 'image/jpeg')).toBe('image/jpeg'); // storage without a content type
    expect(imageMime('image/gif', 'image/gif')).toBe('image/webp');
  });
});
