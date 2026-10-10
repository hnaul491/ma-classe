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
 */
export function isFilePathFor(fileId: string, path: string): boolean {
  const parts = path.split('/');
  return parts.length === 2 && parts[0] !== '' && parts[0] !== '.' && parts[0] !== '..' && parts[1] === `${fileId}.webp`;
}

export type RenderedPage = { blob: Blob; width: number; height: number };

export async function uploadBoardImage(
  lessonId: string,
  page: RenderedPage,
  kind: 'page' | 'image',
  name: string,
  doc?: { documentId: string; pageIndex: number },
): Promise<{ fileId: string; path: string }> {
  const supabase = createBrowserSupabase();
  const fileId = crypto.randomUUID();
  const path = `${lessonId}/${fileId}.webp`;
  const up = await supabase.storage.from(BUCKET).upload(path, page.blob, { contentType: 'image/webp', upsert: false });
  if (up.error) throw new Error('Could not upload the image', { cause: up.error });
  const row = await supabase.from('files').insert({
    id: fileId,
    lesson_id: lessonId,
    storage_path: path,
    kind,
    mime: 'image/webp',
    size_bytes: page.blob.size,
    width: page.width,
    height: page.height,
    name,
    document_id: doc?.documentId ?? null,
    page_index: doc?.pageIndex ?? 0,
  });
  if (row.error) throw new Error('Could not record the image', { cause: row.error });
  return { fileId, path };
}

export async function downloadAsDataURL(path: string): Promise<string> {
  const { data, error } = await createBrowserSupabase().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('Could not download the image', { cause: error });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(data);
  });
}
