import { describe, expect, it } from 'vitest';
import { filterDocuments, groupDocuments, legacyFileRow, type FileRow } from './group';

function row(p: Partial<FileRow> & { id: string }): FileRow {
  return {
    lesson_id: 'L1',
    storage_path: `L1/${p.id}.webp`,
    kind: 'page',
    width: 1000,
    height: 1400,
    name: 'Doc.pdf',
    created_at: '2026-10-01T10:00:00Z',
    document_id: null,
    page_index: 0,
    ...p,
  };
}

describe('groupDocuments', () => {
  it('keeps the pages of one PDF together, in page order', () => {
    const docs = groupDocuments([
      row({ id: 'b', document_id: 'D1', page_index: 1 }),
      row({ id: 'a', document_id: 'D1', page_index: 0 }),
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('D1');
    expect(docs[0].kind).toBe('pdf');
    expect(docs[0].pages.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('makes a row without a document id its own document', () => {
    const docs = groupDocuments([row({ id: 'img1', kind: 'image', name: 'photo.png', document_id: null })]);
    expect(docs).toEqual([
      expect.objectContaining({ id: 'img1', kind: 'image', name: 'photo.png', lessonId: 'L1', pages: [expect.objectContaining({ id: 'img1' })] }),
    ]);
  });

  it('puts the newest document first', () => {
    const docs = groupDocuments([
      row({ id: 'old', created_at: '2026-09-01T10:00:00Z' }),
      row({ id: 'new', created_at: '2026-10-05T10:00:00Z' }),
      row({ id: 'mid', created_at: '2026-09-20T10:00:00Z' }),
    ]);
    expect(docs.map((d) => d.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('filterDocuments', () => {
  const docs = groupDocuments([
    row({ id: 'p', name: 'Passé composé.pdf', created_at: '2026-10-02T10:00:00Z' }),
    row({ id: 'v', name: 'Vocabulaire marché.pdf', created_at: '2026-10-01T10:00:00Z' }),
  ]);

  it('matches names ignoring case and accents', () => {
    expect(filterDocuments(docs, 'PASSE').map((d) => d.name)).toEqual(['Passé composé.pdf']);
    expect(filterDocuments(docs, 'marche').map((d) => d.name)).toEqual(['Vocabulaire marché.pdf']);
  });

  it('returns everything for a blank query', () => {
    expect(filterDocuments(docs, '   ')).toHaveLength(2);
    expect(filterDocuments(docs, '')).toHaveLength(2);
  });
});

describe('legacyFileRow', () => {
  it('fills the document columns for rows read before migration 0004', () => {
    const { document_id, page_index, ...legacy } = row({ id: 'x', document_id: 'D', page_index: 3 });
    void document_id;
    void page_index;
    expect(legacyFileRow(legacy)).toEqual({ ...legacy, document_id: null, page_index: 0 });
  });
});
