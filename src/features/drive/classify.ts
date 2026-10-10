import { MAX_BYTES } from '@/features/board/upload';

/** A file chosen in the Drive Picker. Google-native files (Docs, Slides…) have no size. */
export type DriveFile = { id: string; name: string; mimeType: string; sizeBytes: number | null };

export type DriveRejectReason = 'drive.video' | 'drive.unsupported' | 'drive.tooLarge';

export type DriveFileKind =
  | { kind: 'pdf' }
  | { kind: 'export-pdf' }
  | { kind: 'image' }
  | { kind: 'audio' }
  | { kind: 'reject'; reason: DriveRejectReason };

export const GOOGLE_DOC = 'application/vnd.google-apps.document';
export const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
/** PDFs and images: the same limit as uploads (30 MB). */
export const DRIVE_DOC_MAX_BYTES = MAX_BYTES;
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

const IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
/** MP3, M4A, WAV and OGG, with the variants Drive and browsers report for them. */
export const AUDIO_MIMES: readonly string[] = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/ogg',
];

const tooLarge = (size: number | null, max: number) => size !== null && size > max;

/**
 * What to do with a picked Drive file. An unknown size passes here; the downloaded file is checked
 * again like an upload. Drive's 10 MB export limit only shows up as an export error.
 */
export function classifyDriveFile(f: DriveFile): DriveFileKind {
  const mime = f.mimeType;
  if (mime.startsWith('video/')) return { kind: 'reject', reason: 'drive.video' };
  if (mime === GOOGLE_DOC || mime === GOOGLE_SLIDES) return { kind: 'export-pdf' };
  if (mime === 'application/pdf') {
    return tooLarge(f.sizeBytes, DRIVE_DOC_MAX_BYTES) ? { kind: 'reject', reason: 'drive.tooLarge' } : { kind: 'pdf' };
  }
  if (IMAGE_MIMES.includes(mime)) {
    return tooLarge(f.sizeBytes, DRIVE_DOC_MAX_BYTES) ? { kind: 'reject', reason: 'drive.tooLarge' } : { kind: 'image' };
  }
  if (AUDIO_MIMES.includes(mime)) {
    return tooLarge(f.sizeBytes, AUDIO_MAX_BYTES) ? { kind: 'reject', reason: 'drive.tooLarge' } : { kind: 'audio' };
  }
  return { kind: 'reject', reason: 'drive.unsupported' };
}
