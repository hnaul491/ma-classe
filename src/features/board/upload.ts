import { shouldRetryWithoutDocumentColumns } from '@/features/documents/group';
import { isUuid } from '@/features/documents/params';
import { createBrowserSupabase } from '@/lib/supabase/client';

export const MAX_BYTES = 30 * 1024 * 1024;
export const MAX_PAGES = 50;
const BUCKET = 'lesson-files';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export type UploadCheck = { ok: true; kind: 'pdf' | 'image' } | { ok: false; reason: 'board.unsupported' | 'board.fileTooLarge' };

export function checkUpload(file: { name: string; type: string; size: number }): UploadCheck {
  const isPdf = file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name));
  const isImage = IMAGE_TYPES.includes(file.type);
  if (!isPdf && !isImage) return { ok: false, reason: 'board.unsupported' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'board.fileTooLarge' };
  return { ok: true, kind: isPdf ? 'pdf' : 'image' };
}

export function pdfPagesError(pageCount: number): 'board.tooManyPages' | null {
  return pageCount > MAX_PAGES ? 'board.tooManyPages' : null;
}

/** A storage path inside this lesson's folder (peer `file` messages must not point elsewhere). */
export function isLessonPath(lessonId: string, path: string): boolean {
  const prefix = `${lessonId}/`;
  return path.startsWith(prefix) && path.length > prefix.length && !path.split('/').includes('..');
}

/**
 * The path an upload gives this file (`<lesson folder>/<fileId>.webp`). A document re-used from an
 * older lesson stays in that lesson's folder, so peer `file` messages may point there too.
 * Upload ids are uuids; anything else is not one of our files.
 */
export function isFilePathFor(fileId: string, path: string): boolean {
  if (!isUuid(fileId)) return false;
  const parts = path.split('/');
  return parts.length === 2 && parts[0] !== '' && parts[0] !== '.' && parts[0] !== '..' && parts[1] === `${fileId}.webp`;
}

export { shouldRetryWithoutDocumentColumns };

type ImageMime = 'image/webp' | 'image/png' | 'image/jpeg';
const isImageMime = (m: string | undefined): m is ImageMime => m === 'image/webp' || m === 'image/png' || m === 'image/jpeg';

/**
 * The image type to store and announce, limited to the bucket's allow-list. A canvas asked for WebP
 * gives PNG on Safari, so the blob's own type is used; anything else falls back (default WebP).
 */
export function imageMime(type: string | undefined, fallback: string = 'image/webp'): ImageMime {
  if (isImageMime(type)) return type;
  return isImageMime(fallback) ? fallback : 'image/webp';
}

export type RenderedPage = { blob: Blob; width: number; height: number };

export async function uploadBoardImage(
  lessonId: string,
  page: RenderedPage,
  kind: 'page' | 'image',
  name: string,
  doc?: { documentId: string; pageIndex: number },
): Promise<{ fileId: string; path: string; mime: ImageMime }> {
  const supabase = createBrowserSupabase();
  const fileId = crypto.randomUUID();
  const path = `${lessonId}/${fileId}.webp`;
  // The path keeps .webp (peer messages are checked against it); the stored type is the real one.
  const mime = imageMime(page.blob.type);
  const up = await supabase.storage.from(BUCKET).upload(path, page.blob, { contentType: mime, upsert: false });
  if (up.error) throw new Error('Could not upload the image', { cause: up.error });
  const base = {
    id: fileId,
    lesson_id: lessonId,
    storage_path: path,
    kind,
    mime,
    size_bytes: page.blob.size,
    width: page.width,
    height: page.height,
    name,
  };
  let row = await supabase.from('files').insert({ ...base, document_id: doc?.documentId ?? null, page_index: doc?.pageIndex ?? 0 });
  // Before migration 0004 runs, record the file without its document grouping rather than fail.
  if (shouldRetryWithoutDocumentColumns(row.error)) row = await supabase.from('files').insert(base);
  if (row.error) throw new Error('Could not record the image', { cause: row.error });
  return { fileId, path, mime };
}

/** The stored image as a data URL, typed with its real (allowed) type; `mime` is used when storage gives none. */
export async function downloadAsDataURL(path: string, mime?: string): Promise<{ dataURL: string; mime: ImageMime }> {
  const { data, error } = await createBrowserSupabase().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('Could not download the image', { cause: error });
  const type = imageMime(data.type, imageMime(mime));
  const blob = data.type === type ? data : new Blob([data], { type });
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { dataURL, mime: type };
}
