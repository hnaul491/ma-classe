// Leaf constants: no imports, so pure modules (classification, media protocol) stay free of
// Supabase and browser code.

/** PDFs and images from Drive: the same limit as board uploads (`MAX_BYTES` in board/upload). */
export const DOC_MAX_BYTES = 30 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

export const IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

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
