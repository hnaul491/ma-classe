import { FILE_ROW_COLUMNS, type FileRow } from '@/features/documents/group';
import { isUuid } from '@/features/documents/params';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { sceneFileIds } from './files';
import type { BoardElement } from './protocol';

export type StoredFile = { id: string; storage_path: string; mime: string; width: number; height: number };

export const backupKey = (lessonId: string) => `board-backup:${lessonId}`;

/** The saved scene and the files it uses. Files are found by id, so documents re-used from older lessons load too. */
export async function loadBoard(lessonId: string): Promise<{ elements: BoardElement[]; files: StoredFile[] }> {
  const supabase = createBrowserSupabase();
  const save = await supabase.from('board_saves').select('scene').eq('lesson_id', lessonId).maybeSingle();
  if (save.error) throw new Error('Could not load the board', { cause: save.error });
  const elements = (save.data?.scene as { elements?: BoardElement[] } | undefined)?.elements ?? [];
  const fileIds = sceneFileIds(elements);
  if (fileIds.length === 0) return { elements, files: [] };
  return { elements, files: await loadFiles(fileIds) };
}

/** The stored files with these ids (missing ids are left out). */
export async function loadFiles(fileIds: readonly string[]): Promise<StoredFile[]> {
  const files = await createBrowserSupabase().from('files').select('id, storage_path, mime, width, height').in('id', fileIds);
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
  if (error) throw new Error('Could not load the document', { cause: error });
  return (data ?? []) as FileRow[];
}

export async function saveBoard(lessonId: string, email: string, elements: readonly BoardElement[]): Promise<void> {
  const { error } = await createBrowserSupabase()
    .from('board_saves')
    .upsert({ lesson_id: lessonId, scene: { elements }, updated_at: new Date().toISOString(), updated_by: email });
  if (error) throw new Error('Could not save the board', { cause: error });
}
