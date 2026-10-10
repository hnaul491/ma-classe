import { createBrowserSupabase } from '@/lib/supabase/client';
import type { BoardElement } from './protocol';

export type StoredFile = { id: string; storage_path: string; mime: string; width: number; height: number };

export const backupKey = (lessonId: string) => `board-backup:${lessonId}`;

export async function loadBoard(lessonId: string): Promise<{ elements: BoardElement[]; files: StoredFile[] }> {
  const supabase = createBrowserSupabase();
  const [save, files] = await Promise.all([
    supabase.from('board_saves').select('scene').eq('lesson_id', lessonId).maybeSingle(),
    supabase.from('files').select('id, storage_path, mime, width, height').eq('lesson_id', lessonId),
  ]);
  if (save.error) throw new Error('Could not load the board', { cause: save.error });
  if (files.error) throw new Error('Could not load board files', { cause: files.error });
  const scene = save.data?.scene as { elements?: BoardElement[] } | undefined;
  return { elements: scene?.elements ?? [], files: (files.data ?? []) as StoredFile[] };
}

export async function saveBoard(lessonId: string, email: string, elements: readonly BoardElement[]): Promise<void> {
  const { error } = await createBrowserSupabase()
    .from('board_saves')
    .upsert({ lesson_id: lessonId, scene: { elements }, updated_at: new Date().toISOString(), updated_by: email });
  if (error) throw new Error('Could not save the board', { cause: error });
}
