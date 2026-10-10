import type { SupabaseClient } from '@supabase/supabase-js';
import { FILE_ROW_COLUMNS, isMissingTable, LEGACY_FILE_ROW_COLUMNS, legacyFileRow, shouldRetryWithoutDocumentColumns, type FileRow } from './group';

/**
 * Every `files` row. Before migration 0004 runs, reads the old columns, so each file is its own
 * document; before migration 0003 (no files table yet), the library is empty.
 */
export async function loadFileRows(supabase: SupabaseClient): Promise<FileRow[]> {
  const rows = await supabase.from('files').select(FILE_ROW_COLUMNS);
  if (!rows.error) return (rows.data ?? []) as FileRow[];
  if (isMissingTable(rows.error)) return [];
  if (!shouldRetryWithoutDocumentColumns(rows.error)) throw new Error('Could not load the documents', { cause: rows.error });
  const legacy = await supabase.from('files').select(LEGACY_FILE_ROW_COLUMNS);
  if (legacy.error) throw new Error('Could not load the documents', { cause: legacy.error });
  return ((legacy.data ?? []) as Omit<FileRow, 'document_id' | 'page_index'>[]).map(legacyFileRow);
}
