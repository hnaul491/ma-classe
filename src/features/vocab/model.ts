export const VOCAB_TOPIC = 'ma-classe-vocab';
export const VOCAB_LIMITS = { french: 200, meaning: 500, example: 1000 } as const;

export type VocabWord = {
  id: string;
  lessonId: string | null;
  french: string;
  meaningVi: string;
  meaningEn: string;
  example: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type VocabDraft = { french: string; meaningVi: string; meaningEn: string; example: string };

export type VocabRow = {
  id: string;
  lesson_id: string | null;
  french: string;
  meaning_vi: string;
  meaning_en: string;
  example: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const VOCAB_COLUMNS = 'id, lesson_id, french, meaning_vi, meaning_en, example, created_by, created_at, updated_at';

export const fromRow = (r: VocabRow): VocabWord => ({
  id: r.id.toLowerCase(),
  lessonId: r.lesson_id,
  french: r.french,
  meaningVi: r.meaning_vi,
  meaningEn: r.meaning_en,
  example: r.example,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function prepareWord(d: VocabDraft): { ok: true; draft: VocabDraft } | { ok: false; reason: 'vocab.frenchRequired' | 'vocab.tooLong' } {
  const draft = { french: d.french.trim(), meaningVi: d.meaningVi.trim(), meaningEn: d.meaningEn.trim(), example: d.example.trim() };
  if (!draft.french) return { ok: false, reason: 'vocab.frenchRequired' };
  if (
    draft.french.length > VOCAB_LIMITS.french ||
    draft.meaningVi.length > VOCAB_LIMITS.meaning ||
    draft.meaningEn.length > VOCAB_LIMITS.meaning ||
    draft.example.length > VOCAB_LIMITS.example
  ) {
    return { ok: false, reason: 'vocab.tooLong' };
  }
  return { ok: true, draft };
}

export type VocabWire = { v: 1; lessonId: string; op: 'upsert'; word: VocabWord } | { v: 1; lessonId: string; op: 'delete'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Wire form: explicit fields only. */
export function encodeVocab(m: VocabWire): string {
  if (m.op === 'delete') return JSON.stringify({ v: 1, lessonId: m.lessonId, op: 'delete', id: m.id });
  const w = m.word;
  return JSON.stringify({
    v: 1,
    lessonId: m.lessonId,
    op: 'upsert',
    word: {
      id: w.id,
      lessonId: w.lessonId,
      french: w.french,
      meaningVi: w.meaningVi,
      meaningEn: w.meaningEn,
      example: w.example,
      createdBy: w.createdBy,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    },
  });
}

/** A peer's message is untrusted: every field is checked, and it must belong to this lesson. */
export function decodeVocab(text: string, lessonId: string): VocabWire | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== 1 || m.lessonId !== lessonId) return null;
  if (m.op === 'delete') {
    return typeof m.id === 'string' && UUID.test(m.id) ? { v: 1, lessonId, op: 'delete', id: m.id.toLowerCase() } : null;
  }
  if (m.op !== 'upsert' || typeof m.word !== 'object' || m.word === null) return null;
  const w = m.word as Record<string, unknown>;
  if (typeof w.id !== 'string' || !UUID.test(w.id) || w.lessonId !== lessonId) return null;
  if (!isText(w.french, VOCAB_LIMITS.french) || !w.french.trim()) return null;
  if (!isText(w.meaningVi, VOCAB_LIMITS.meaning) || !isText(w.meaningEn, VOCAB_LIMITS.meaning)) return null;
  if (!isText(w.example, VOCAB_LIMITS.example) || !isText(w.createdBy, 320)) return null;
  if (!isDate(w.createdAt) || !isDate(w.updatedAt)) return null;
  return {
    v: 1,
    lessonId,
    op: 'upsert',
    word: {
      id: w.id.toLowerCase(),
      lessonId,
      french: w.french,
      meaningVi: w.meaningVi,
      meaningEn: w.meaningEn,
      example: w.example,
      createdBy: w.createdBy,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    },
  };
}

/** By id; the later `updatedAt` (the server's clock) wins. Sorted by creation time, then id. */
export function mergeWords(a: readonly VocabWord[], b: readonly VocabWord[]): VocabWord[] {
  const byId = new Map<string, VocabWord>();
  for (const w of [...a, ...b]) {
    const prev = byId.get(w.id);
    if (!prev || Date.parse(w.updatedAt) > Date.parse(prev.updatedAt)) byId.set(w.id, w);
  }
  return [...byId.values()].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || x.id.localeCompare(y.id));
}

export type VocabState = { words: VocabWord[]; deleted: ReadonlySet<string> };
export type VocabAction = { type: 'loaded'; words: VocabWord[] } | { type: 'upsert'; word: VocabWord } | { type: 'delete'; id: string };
export const initialVocab: VocabState = { words: [], deleted: new Set() };

/** A deleted id is remembered for this session, so a late live copy or a stale reload never brings it back. */
export function vocabReducer(s: VocabState, a: VocabAction): VocabState {
  switch (a.type) {
    case 'loaded':
      return { ...s, words: mergeWords(s.words, a.words.filter((w) => !s.deleted.has(w.id))) };
    case 'upsert':
      return s.deleted.has(a.word.id) ? s : { ...s, words: mergeWords(s.words, [a.word]) };
    case 'delete':
      return { words: s.words.filter((w) => w.id !== a.id), deleted: new Set([...s.deleted, a.id]) };
  }
}

/** Lower case without accents, so "ete" finds "été", "coeur" finds "cœur", "dep" finds "đẹp". */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function searchWords(words: readonly VocabWord[], query: string): VocabWord[] {
  const q = foldText(query.trim());
  if (!q) return [...words];
  return words.filter((w) => [w.french, w.meaningVi, w.meaningEn, w.example].some((f) => foldText(f).includes(q)));
}
