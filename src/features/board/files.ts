import { isUuid } from '@/features/documents/params';

type MaybeImage = { type?: unknown; fileId?: unknown; isDeleted?: unknown };

/**
 * Each stored image file id the live elements use, once, in scene order. Only uuids: those are
 * `files` rows. Excalidraw's own SHA-1 ids are never stored, and querying them fails (22P02).
 */
export function sceneFileIds(elements: readonly object[]): string[] {
  const ids: string[] = [];
  for (const e of elements as readonly MaybeImage[]) {
    if (e.isDeleted === true) continue;
    if (typeof e.fileId === 'string' && isUuid(e.fileId)) ids.push(e.fileId);
  }
  return [...new Set(ids)];
}

/** Pasted elements with an image that is not one of our uploads (it would never reach the other person). */
export function hasUnstoredImages(elements: readonly object[]): boolean {
  return (elements as readonly MaybeImage[]).some((e) => e.type === 'image' && !(typeof e.fileId === 'string' && isUuid(e.fileId)));
}

/** The file to add from a drop or a paste, or null (then Excalidraw handles it: text, elements). */
export function droppedFile<F>(files: ArrayLike<F> | null | undefined): F | null {
  return files && files.length > 0 ? files[0] : null;
}
