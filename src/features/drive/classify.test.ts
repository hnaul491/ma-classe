import { describe, expect, it } from 'vitest';
import { AUDIO_MIMES, classifyDriveFile, type DriveFile } from './classify';

const MB = 1024 * 1024;
const file = (mimeType: string, sizeBytes: number | null = 1000, name = 'f'): DriveFile => ({ id: 'id1', name, mimeType, sizeBytes });

describe('classifyDriveFile', () => {
  it('downloads PDFs up to 30 MB', () => {
    expect(classifyDriveFile(file('application/pdf'))).toEqual({ kind: 'pdf' });
    expect(classifyDriveFile(file('application/pdf', 30 * MB))).toEqual({ kind: 'pdf' });
  });

  it('rejects a 40 MB PDF as too large', () => {
    expect(classifyDriveFile(file('application/pdf', 40 * MB))).toEqual({ kind: 'reject', reason: 'drive.tooLarge' });
    expect(classifyDriveFile(file('application/pdf', 30 * MB + 1))).toEqual({ kind: 'reject', reason: 'drive.tooLarge' });
  });

  it('exports Google Docs and Slides to PDF (native files have no size)', () => {
    expect(classifyDriveFile(file('application/vnd.google-apps.document', null))).toEqual({ kind: 'export-pdf' });
    expect(classifyDriveFile(file('application/vnd.google-apps.presentation', null))).toEqual({ kind: 'export-pdf' });
  });

  it('rejects Google Sheets and other Google-native types', () => {
    expect(classifyDriveFile(file('application/vnd.google-apps.spreadsheet', null))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
    expect(classifyDriveFile(file('application/vnd.google-apps.folder', null))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
    expect(classifyDriveFile(file('application/vnd.google-apps.shortcut', null))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
  });

  it('downloads PNG, JPEG and WebP images, with the upload size limit', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(classifyDriveFile(file(mime))).toEqual({ kind: 'image' });
      expect(classifyDriveFile(file(mime, 31 * MB))).toEqual({ kind: 'reject', reason: 'drive.tooLarge' });
    }
  });

  it('rejects other images and office files', () => {
    expect(classifyDriveFile(file('image/gif'))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
    expect(classifyDriveFile(file('image/heic'))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
    expect(classifyDriveFile(file('application/vnd.openxmlformats-officedocument.presentationml.presentation'))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
    expect(classifyDriveFile(file(''))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
  });

  it('accepts MP3, M4A, WAV and OGG audio (with their Drive mime variants) up to 50 MB', () => {
    for (const mime of ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg']) {
      expect(AUDIO_MIMES).toContain(mime);
      expect(classifyDriveFile(file(mime))).toEqual({ kind: 'audio' });
      expect(classifyDriveFile(file(mime, 50 * MB))).toEqual({ kind: 'audio' });
    }
  });

  it('rejects a 60 MB audio file as too large', () => {
    expect(classifyDriveFile(file('audio/mpeg', 60 * MB))).toEqual({ kind: 'reject', reason: 'drive.tooLarge' });
  });

  it('rejects other audio formats', () => {
    expect(classifyDriveFile(file('audio/flac'))).toEqual({ kind: 'reject', reason: 'drive.unsupported' });
  });

  it('sends video files to tab sharing, whatever their size', () => {
    expect(classifyDriveFile(file('video/mp4'))).toEqual({ kind: 'reject', reason: 'drive.video' });
    expect(classifyDriveFile(file('video/quicktime', 900 * MB))).toEqual({ kind: 'reject', reason: 'drive.video' });
    expect(classifyDriveFile(file('video/webm', null))).toEqual({ kind: 'reject', reason: 'drive.video' });
  });

  it('lets a file of unknown size through (the size is checked again after download)', () => {
    expect(classifyDriveFile(file('application/pdf', null))).toEqual({ kind: 'pdf' });
    expect(classifyDriveFile(file('audio/ogg', null))).toEqual({ kind: 'audio' });
  });
});
