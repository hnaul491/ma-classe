import { describe, expect, it } from 'vitest';
import {
  decodeVocab,
  encodeVocab,
  foldText,
  fromRow,
  initialVocab,
  mergeWords,
  prepareWord,
  searchWords,
  vocabReducer,
  type VocabWord,
} from './model';

const L = '11111111-1111-4111-8111-111111111111';
const word = (over: Partial<VocabWord> = {}): VocabWord => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lessonId: L,
  french: 'été',
  meaningVi: 'mùa hè',
  meaningEn: 'summer',
  example: 'L’été est chaud.',
  createdBy: 'anna@example.com',
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

describe('prepareWord', () => {
  it('trims every field', () => {
    expect(prepareWord({ french: '  chat ', meaningVi: ' mèo ', meaningEn: ' cat ', example: ' Le chat. ' })).toEqual({
      ok: true,
      draft: { french: 'chat', meaningVi: 'mèo', meaningEn: 'cat', example: 'Le chat.' },
    });
  });
  it('needs the French word', () => {
    expect(prepareWord({ french: '   ', meaningVi: 'x', meaningEn: '', example: '' })).toEqual({ ok: false, reason: 'vocab.frenchRequired' });
  });
  it('refuses text over the limits', () => {
    expect(prepareWord({ french: 'a'.repeat(201), meaningVi: '', meaningEn: '', example: '' })).toEqual({ ok: false, reason: 'vocab.tooLong' });
    expect(prepareWord({ french: 'a', meaningVi: 'b'.repeat(501), meaningEn: '', example: '' })).toEqual({ ok: false, reason: 'vocab.tooLong' });
    expect(prepareWord({ french: 'a', meaningVi: '', meaningEn: '', example: 'c'.repeat(1001) })).toEqual({ ok: false, reason: 'vocab.tooLong' });
  });
});

describe('fromRow', () => {
  it('maps the database columns', () => {
    expect(
      fromRow({
        id: word().id,
        lesson_id: L,
        french: 'été',
        meaning_vi: 'mùa hè',
        meaning_en: 'summer',
        example: 'L’été est chaud.',
        created_by: 'anna@example.com',
        created_at: '2026-10-10T10:00:00.000Z',
        updated_at: '2026-10-10T10:00:00.000Z',
      }),
    ).toEqual(word());
  });
});

describe('wire format', () => {
  it('round-trips an upsert and a delete', () => {
    const up = { v: 1 as const, lessonId: L, op: 'upsert' as const, word: word() };
    expect(decodeVocab(encodeVocab(up), L)).toEqual(up);
    const del = { v: 1 as const, lessonId: L, op: 'delete' as const, id: word().id };
    expect(decodeVocab(encodeVocab(del), L)).toEqual(del);
  });
  it('rejects another lesson, a bad id, over-long text, bad dates and junk', () => {
    expect(decodeVocab(encodeVocab({ v: 1, lessonId: L, op: 'upsert', word: word() }), '22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(decodeVocab(encodeVocab({ v: 1, lessonId: L, op: 'upsert', word: word({ id: 'nope' }) }), L)).toBeNull();
    expect(decodeVocab(encodeVocab({ v: 1, lessonId: L, op: 'upsert', word: word({ french: 'a'.repeat(201) }) }), L)).toBeNull();
    expect(decodeVocab(encodeVocab({ v: 1, lessonId: L, op: 'upsert', word: word({ updatedAt: 'yesterday' }) }), L)).toBeNull();
    expect(decodeVocab(encodeVocab({ v: 1, lessonId: L, op: 'upsert', word: word({ lessonId: null }) }), L)).toBeNull();
    expect(decodeVocab('not json', L)).toBeNull();
    expect(decodeVocab(JSON.stringify({ v: 2, lessonId: L, op: 'delete', id: word().id }), L)).toBeNull();
    expect(decodeVocab(JSON.stringify({ v: 1, lessonId: L, op: 'drop', id: word().id }), L)).toBeNull();
  });
});

describe('mergeWords', () => {
  it('keeps the newer edit whichever order they arrive in', () => {
    const old = word({ meaningEn: 'summer', updatedAt: '2026-10-10T10:00:00.000Z' });
    const neu = word({ meaningEn: 'summertime', updatedAt: '2026-10-10T10:05:00.000Z' });
    expect(mergeWords([neu], [old])[0].meaningEn).toBe('summertime');
    expect(mergeWords([old], [neu])[0].meaningEn).toBe('summertime');
  });
  it('orders by creation time, then id', () => {
    const a = word({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', createdAt: '2026-10-10T11:00:00.000Z' });
    const b = word({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', createdAt: '2026-10-10T09:00:00.000Z' });
    expect(mergeWords([a], [b]).map((w) => w.id)).toEqual([b.id, a.id]);
  });
});

describe('vocabReducer', () => {
  it('a deleted word never comes back from a late upsert or a reload', () => {
    let s = vocabReducer(initialVocab, { type: 'upsert', word: word() });
    s = vocabReducer(s, { type: 'delete', id: word().id });
    expect(s.words).toEqual([]);
    s = vocabReducer(s, { type: 'upsert', word: word({ updatedAt: '2026-10-10T12:00:00.000Z' }) });
    expect(s.words).toEqual([]);
    s = vocabReducer(s, { type: 'loaded', words: [word()] });
    expect(s.words).toEqual([]);
  });
  it('a reload merges with what arrived live', () => {
    const live = word({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', createdAt: '2026-10-10T10:30:00.000Z' });
    let s = vocabReducer(initialVocab, { type: 'upsert', word: live });
    s = vocabReducer(s, { type: 'loaded', words: [word()] });
    expect(s.words.map((w) => w.id)).toEqual([word().id, live.id]);
  });
});

describe('search', () => {
  it('folds accents, ligatures and the Vietnamese đ', () => {
    expect(foldText('Été')).toBe('ete');
    expect(foldText('cœur')).toBe('coeur');
    expect(foldText('ăn')).toBe('an');
    expect(foldText('Đẹp')).toBe('dep');
  });
  it('matches the French word, both meanings and the example', () => {
    const words = [
      word(),
      word({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', french: 'cœur', meaningVi: 'trái tim', meaningEn: 'heart', example: '' }),
      word({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf', french: 'beau', meaningVi: 'đẹp', meaningEn: 'beautiful', example: '' }),
    ];
    expect(searchWords(words, 'ETE').map((w) => w.french)).toEqual(['été']);
    expect(searchWords(words, 'coeur').map((w) => w.french)).toEqual(['cœur']);
    expect(searchWords(words, 'dep').map((w) => w.french)).toEqual(['beau']);
    expect(searchWords(words, 'heart').map((w) => w.french)).toEqual(['cœur']);
    expect(searchWords(words, 'chaud').map((w) => w.french)).toEqual(['été']);
    expect(searchWords(words, '   ')).toHaveLength(3);
  });
});
