import { FILE_ROW_COLUMNS, LEGACY_FILE_ROW_COLUMNS, legacyFileRow, shouldRetryWithoutDocumentColumns, type FileRow } from '@/features/documents/group';
import { isUuid } from '@/features/documents/params';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { BACKUP_PREFIX } from './backup';
import { isMissingFunction } from './merge';
import type { BoardElement } from './protocol';

export type StoredFile = { id: string; storage_path: string; mime: string; width: number; height: number };

export const backupKey = (lessonId: string) => `${BACKUP_PREFIX}${lessonId}`;

/**
 * The saved scene. Its images are fetched afterwards, in the background (Board's fetchMissingFiles),
 * so a slow image never holds up the board.
 */
export async function loadBoard(lessonId: string): Promise<BoardElement[]> {
  const save = await createBrowserSupabase().from('board_saves').select('scene').eq('lesson_id', lessonId).maybeSingle();
  if (save.error) throw new Error('Could not load the board', { cause: save.error });
  const elements = (save.data?.scene as { elements?: unknown } | undefined)?.elements;
  return Array.isArray(elements) ? (elements as BoardElement[]) : [];
}

/** The stored files with these ids (missing ids are left out). */
export async function loadFiles(fileIds: readonly string[]): Promise<StoredFile[]> {
  // The id column is a uuid: any other id would fail the whole query (22P02).
  const ids = fileIds.filter(isUuid);
  if (ids.length === 0) return [];
  const files = await createBrowserSupabase().from('files').select('id, storage_path, mime, width, height').in('id', ids);
  if (files.error) throw new Error('Could not load board files', { cause: files.error });
  return (files.data ?? []) as StoredFile[];
}

/** Every page of one document (or the single file whose own id it is), in page order. */
export async function loadDocumentFiles(documentId: string): Promise<FileRow[]> {
  if (!isUuid(documentId)) throw new Error('Not a document id');
  const { data, error } = await createBrowserSupabase()
    .from('files')
    .select(FILE_ROW_COLUMNS)
    .or(`document_id.eq.${documentId},id.eq.${documentId}`)
    .order('page_index', { ascending: true });
  if (!error) return (data ?? []) as FileRow[];
  if (!shouldRetryWithoutDocumentColumns(error)) throw new Error('Could not load the document', { cause: error });
  // Before migration 0004 runs, every file is its own document.
  const legacy = await createBrowserSupabase().from('files').select(LEGACY_FILE_ROW_COLUMNS).eq('id', documentId);
  if (legacy.error) throw new Error('Could not load the document', { cause: legacy.error });
  return ((legacy.data ?? []) as Omit<FileRow, 'document_id' | 'page_index'>[]).map(legacyFileRow);
}

/**
 * Saves the scene by merging it into the stored one, element by element (migration 0006), so a
 * client with a stale scene cannot roll the board back. Before 0006 runs, falls back to a plain upsert.
 */
export async function saveBoard(lessonId: string, email: string, elements: readonly BoardElement[]): Promise<void> {
  const supabase = createBrowserSupabase();
  const merged = await supabase.rpc('merge_board_save', { p_lesson_id: lessonId, p_elements: elements, p_email: email });
  if (!merged.error) return;
  if (!isMissingFunction(merged.error)) throw new Error('Could not save the board', { cause: merged.error });
  const { error } = await supabase
    .from('board_saves')
    .upsert({ lesson_id: lessonId, scene: { elements }, updated_at: new Date().toISOString(), updated_by: email });
  if (error) throw new Error('Could not save the board', { cause: error });
}
