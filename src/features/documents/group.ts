export type FileRow = {
  id: string; lesson_id: string; storage_path: string; kind: 'page' | 'image';
  width: number; height: number; name: string; created_at: string;
  document_id: string | null; page_index: number;
};
export type DocumentGroup = { id: string; name: string; lessonId: string; createdAt: string; kind: 'pdf' | 'image'; pages: FileRow[] };

/** The `files` columns a FileRow needs, for `select(...)`. */
export const FILE_ROW_COLUMNS = 'id, lesson_id, storage_path, kind, width, height, name, created_at, document_id, page_index';

export function groupDocuments(rows: readonly FileRow[]): DocumentGroup[] {
  const byId = new Map<string, DocumentGroup>();
  for (const r of rows) {
    const id = r.document_id ?? r.id;
    let doc = byId.get(id);
    if (!doc) {
      doc = { id, name: r.name, lessonId: r.lesson_id, createdAt: r.created_at, kind: r.kind === 'page' ? 'pdf' : 'image', pages: [] };
      byId.set(id, doc);
    }
    if (r.created_at < doc.createdAt) doc.createdAt = r.created_at;
    doc.pages.push(r);
  }
  const docs = [...byId.values()];
  for (const d of docs) d.pages.sort((a, b) => a.page_index - b.page_index);
  return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function filterDocuments(docs: readonly DocumentGroup[], query: string): DocumentGroup[] {
  const q = fold(query.trim());
  return q ? docs.filter((d) => fold(d.name).includes(q)) : [...docs];
}
