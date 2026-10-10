import { withTimeout } from '@/features/board/retry';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { fromRow, VOCAB_COLUMNS, type VocabDraft, type VocabRow, type VocabWord } from './model';

export type VocabErrorKey = 'vocab.notReady' | 'vocab.notAllowed' | 'vocab.saveFailed' | 'vocab.gone';
export type VocabResult<T> = { ok: true; value: T } | { ok: false; error: VocabErrorKey };
/** What a word form can be told back: a database problem, or a draft that does not pass the checks. */
export type DraftError = VocabErrorKey | 'vocab.frenchRequired' | 'vocab.tooLong';

/** A call that has not answered after this long counts as failed. */
const TIMEOUT_MS = 10_000;

export function vocabErrorKey(error: { code?: string; message?: string } | null): VocabErrorKey {
  const code = error?.code ?? '';
  // Undefined table / not in PostgREST's schema cache: migration 0007 has not been run.
  if (code === '42P01' || code === 'PGRST205') return 'vocab.notReady';
  // Refused by RLS or by a missing grant.
  if (code === '42501' || code === 'PGRST301') return 'vocab.notAllowed';
  return 'vocab.saveFailed';
}

const failed: VocabResult<never> = { ok: false, error: 'vocab.saveFailed' };

async function run<T>(work: () => Promise<VocabResult<T>>): Promise<VocabResult<T>> {
  try {
    return await withTimeout(work(), TIMEOUT_MS, failed);
  } catch {
    return failed;
  }
}

const toRow = (d: VocabDraft) => ({ french: d.french, meaning_vi: d.meaningVi, meaning_en: d.meaningEn, example: d.example });

export function loadLessonWords(lessonId: string): Promise<VocabResult<VocabWord[]>> {
  return run(async () => {
    const { data, error } = await createBrowserSupabase()
      .from('vocab')
      .select(VOCAB_COLUMNS)
      .eq('lesson_id', lessonId)
      .order('created_at');
    return error ? { ok: false, error: vocabErrorKey(error) } : { ok: true, value: ((data ?? []) as VocabRow[]).map(fromRow) };
  });
}

export function insertWord(lessonId: string | null, draft: VocabDraft, email: string): Promise<VocabResult<VocabWord>> {
  return run(async () => {
    const { data, error } = await createBrowserSupabase()
      .from('vocab')
      .insert({ lesson_id: lessonId, created_by: email.toLowerCase(), ...toRow(draft) })
      .select(VOCAB_COLUMNS)
      .single();
    return error || !data ? { ok: false, error: vocabErrorKey(error) } : { ok: true, value: fromRow(data as VocabRow) };
  });
}

export function updateWord(id: string, draft: VocabDraft): Promise<VocabResult<VocabWord>> {
  return run(async () => {
    const { data, error } = await createBrowserSupabase()
      .from('vocab')
      .update(toRow(draft))
      .eq('id', id)
      .select(VOCAB_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: vocabErrorKey(error) };
    // RLS hides a refused update as "0 rows", not as an error.
    // Both members may update, so no row back means the word was deleted in the meantime.
    return data ? { ok: true, value: fromRow(data as VocabRow) } : { ok: false, error: 'vocab.gone' };
  });
}

export function deleteWord(id: string): Promise<VocabResult<null>> {
  return run(async () => {
    // RLS hides a refused delete as "0 rows": ask for the deleted row back to tell the two apart.
    const { data, error } = await createBrowserSupabase().from('vocab').delete().eq('id', id).select('id');
    if (error) return { ok: false, error: vocabErrorKey(error) };
    return (data ?? []).length > 0 ? { ok: true, value: null } : { ok: false, error: 'vocab.notAllowed' };
  });
}

/** One word, read again from the database: `null` when it no longer exists. */
export function loadWord(id: string): Promise<VocabResult<VocabWord | null>> {
  return run(async () => {
    const { data, error } = await createBrowserSupabase().from('vocab').select(VOCAB_COLUMNS).eq('id', id).maybeSingle();
    if (error) return { ok: false, error: vocabErrorKey(error) };
    return { ok: true, value: data ? fromRow(data as VocabRow) : null };
  });
}

export type VocabHintAction = { type: 'delete'; id: string } | { type: 'upsert'; word: VocabWord };

/**
 * A peer's live message only says "word `id` changed": what to do comes from the database row.
 * Gone: delete it here. There and in this lesson: show the database copy.
 * A failed read, or a row of another lesson, changes nothing; the next reload reconciles.
 */
export function vocabHintAction(id: string, lessonId: string, r: VocabResult<VocabWord | null>): VocabHintAction | null {
  if (!r.ok) return null;
  if (r.value === null) return { type: 'delete', id };
  return r.value.lessonId === lessonId ? { type: 'upsert', word: r.value } : null;
}
