import { describe, expect, it, vi } from 'vitest';

/** What the next `maybeSingle()` answers; every other builder call returns the builder. */
const db = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabase: () => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'update', 'eq', 'select']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve(db.result);
    return q;
  },
}));

import { loadWord, updateWord, vocabErrorKey, vocabHintAction } from './api';

describe('vocabErrorKey', () => {
  it('a missing table means migration 0007 has not run', () => {
    expect(vocabErrorKey({ code: '42P01' })).toBe('vocab.notReady');
    expect(vocabErrorKey({ code: 'PGRST205' })).toBe('vocab.notReady');
  });
  it('a refused write is a permission problem', () => {
    expect(vocabErrorKey({ code: '42501' })).toBe('vocab.notAllowed');
    expect(vocabErrorKey({ code: 'PGRST301' })).toBe('vocab.notAllowed');
  });
  it('anything else, or no error object, is a failed save', () => {
    expect(vocabErrorKey({ code: '23514' })).toBe('vocab.saveFailed');
    expect(vocabErrorKey(null)).toBe('vocab.saveFailed');
  });
});

describe('updateWord', () => {
  const draft = { french: 'été', meaningVi: 'mùa hè', meaningEn: 'summer', example: '' };
  const row = {
    id: 'AAAAAAAA-0000-4000-8000-000000000001',
    lesson_id: null,
    french: 'été',
    meaning_vi: 'mùa hè',
    meaning_en: 'summer',
    example: '',
    created_by: 'teacher@example.com',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:05:00Z',
  };

  it('returns the saved row', async () => {
    db.result = { data: row, error: null };
    const r = await updateWord(row.id, draft);
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ id: row.id.toLowerCase(), french: 'été', meaningEn: 'summer' }) });
  });

  it('no row and no error means the word was deleted meanwhile', async () => {
    db.result = { data: null, error: null };
    expect(await updateWord(row.id, draft)).toEqual({ ok: false, error: 'vocab.gone' });
  });

  it('an error is mapped to its key', async () => {
    db.result = { data: null, error: { code: '42P01' } };
    expect(await updateWord(row.id, draft)).toEqual({ ok: false, error: 'vocab.notReady' });
  });
});

describe('loadWord', () => {
  const row = {
    id: 'AAAAAAAA-0000-4000-8000-000000000002',
    lesson_id: 'bbbbbbbb-0000-4000-8000-000000000001',
    french: 'automne',
    meaning_vi: 'mùa thu',
    meaning_en: 'autumn',
    example: '',
    created_by: 'teacher@example.com',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:05:00Z',
  };

  it('returns the row from the database', async () => {
    db.result = { data: row, error: null };
    expect(await loadWord(row.id)).toEqual({ ok: true, value: expect.objectContaining({ id: row.id.toLowerCase(), french: 'automne' }) });
  });

  it('no row means the word is gone', async () => {
    db.result = { data: null, error: null };
    expect(await loadWord(row.id)).toEqual({ ok: true, value: null });
  });

  it('an error is mapped to its key', async () => {
    db.result = { data: null, error: { code: '42501' } };
    expect(await loadWord(row.id)).toEqual({ ok: false, error: 'vocab.notAllowed' });
  });
});

describe('vocabHintAction', () => {
  const lessonId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const id = 'aaaaaaaa-0000-4000-8000-000000000002';
  const word = {
    id,
    lessonId,
    french: 'automne',
    meaningVi: 'mùa thu',
    meaningEn: 'autumn',
    example: '',
    createdBy: 'teacher@example.com',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:05:00Z',
  };

  it('the row is gone from the database: delete it here', () => {
    expect(vocabHintAction(id, lessonId, { ok: true, value: null })).toEqual({ type: 'delete', id });
  });

  it('the row exists: show the database copy', () => {
    expect(vocabHintAction(id, lessonId, { ok: true, value: word })).toEqual({ type: 'upsert', word });
  });

  it('a failed read is ignored: the next reload reconciles', () => {
    expect(vocabHintAction(id, lessonId, { ok: false, error: 'vocab.saveFailed' })).toBeNull();
  });

  it('a row of another lesson, or of none, is not shown in this one', () => {
    expect(vocabHintAction(id, lessonId, { ok: true, value: { ...word, lessonId: 'cccccccc-0000-4000-8000-000000000001' } })).toBeNull();
    expect(vocabHintAction(id, lessonId, { ok: true, value: { ...word, lessonId: null } })).toBeNull();
  });
});
