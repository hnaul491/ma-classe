# Ma Classe Plan 5: Vocabulary, Lesson Review and Usage Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three things, all from spec §1–§2, §5, §10–§12:
- the teacher records vocabulary during a lesson, and both members see it live;
- every word can be searched and self-quizzed on `/vocab`;
- any ended lesson can be reopened read-only on `/lesson/[id]/review`;
- the home page shows how much of the free plans this month has used.

**Architecture:**
- **Vocabulary** follows the chat pattern:
  - The rows live in Supabase (`vocab`, migration 0007) under row-level security.
  - Writes go to the database first. The saved row (with server timestamps) is then broadcast on a LiveKit text stream (`ma-classe-vocab`), so both clients merge rows that carry the same clock.
  - Pure logic (validation, wire format, merge, accent-insensitive search) lives in `src/features/vocab/model.ts`. The database calls live in `src/features/vocab/api.ts`, which both the lesson panel and the `/vocab` page use.
- **The lesson side panel** gets two tabs, Chat and Vocabulary, in both the docked and the overlay placement.
- **The review page** is a server page:
  - It shows a read-only Excalidraw board (client component, view mode), the chat transcript and the lesson's words.
- **The usage meter** is a pure estimate (`src/features/usage/estimate.ts`), rendered on the home page.

**Tech Stack:**
- Next.js 16 App Router with server components and server actions; React 19; TypeScript.
- Tailwind v4, using the existing `.btn` / `.field` / `.card` / `.link` components.
- Supabase: `@supabase/ssr` on the server, `createBrowserSupabase` in the browser.
- LiveKit text streams (`registerTextStreamHandler` / `sendText`).
- `@excalidraw/excalidraw` 0.18.1.
- Vitest (node environment) for tests.

**Spec:** `docs/superpowers/specs/2026-10-10-ma-classe-design.md`. Read §2 (scope), §5 (pages, layout C "Chat/Vocab tabs below"), §10 (`vocab` table), §11 (vocab RLS) and §12 ("Free limit approaching").

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know". Read the relevant guide in `node_modules/next/dist/docs/` before writing routing or server-action code.
- **Vocabulary access** (spec §11): "Vocab insert is teacher-only; vocab update is open to both." Delete is teacher-only: this plan adds it so mistakes can be fixed.
- **Usage meter** (spec §12):
  - It warns at 70%.
  - "Minutes and data are estimated from lesson durations × 2 participants (× 540p bitrate for data); storage is the sum of `files.size_bytes`."
- **Free limits** (spec §4):
  - LiveKit: 5,000 participant-minutes and 50 GB downstream per month.
  - Supabase: 1 GB file storage.
- **Languages** (spec §5):
  - Every user-facing string goes in `src/lib/i18n/messages.ts`, in EN and FR. `fr` is a `Record<MessageKey, string>`, so a missing FR key fails `tsc`.
  - FR copy is gender-neutral and uses the typographic apostrophe `’`.
  - Copy style: sentence case, plain verbs, no apology.
  - Dates are shown in the viewer's language and time zone (`getLocale`, `getTimeZone`, `formatLessonDate`).
- **Files** use CRLF line endings. Keep each file's existing line endings.
- **Security:**
  - Never print or log secret values.
  - A peer's message is untrusted: decoders validate every field and length.
  - User text is rendered as React text only, never as HTML.
- **Migrations:** the user runs them in the Supabase SQL Editor. Code must keep working, with a clear message, before 0007 has run.
- **Pre-commit checks:** run `npm test`, `npx tsc --noEmit`, `npm run lint` (0 errors, 0 warnings in touched files) and `npm run build`.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Edits that arrive late or twice.** An older update of a word must never overwrite a newer one, and a word that was deleted must never come back. Pinned by `mergeWords` and `vocabReducer` tests in Task 1.
2. **Accent and diacritic search.** All of these must match:
   - `ete` matches "été";
   - `coeur` matches "cœur";
   - `an` matches Vietnamese "ăn";
   - `dep` matches "đẹp" (`đ` has no Unicode decomposition).

   Pinned by `searchWords` tests in Task 1.
3. **The review page with nothing to show.** For an ended lesson with no board save, no chat and no words, each section shows an empty note, not an error. A live lesson redirects to the room, and an unknown or malformed id gives 404. Pinned by the `reviewTarget` tests in Task 5.
4. **Lessons that cross a month boundary, and a lesson left live by mistake.** The usage estimate counts only the minutes inside the current month. A lesson's duration is capped at the 4-hour token lifetime. Pinned by the `estimateUsage` tests in Task 6.
5. **Writing vocabulary before migration 0007 has run, or when a write is refused.** A missing table or an RLS refusal shows a clear toast or note. It must never crash the room or leave a word shown as saved when it was not. Pinned by the `vocabErrorKey` tests in Task 2.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0007_vocab.sql` | `vocab` table, row-level security, `updated_at` trigger | 1 |
| `src/features/vocab/model.ts` (+ test) | Types, validation, wire encode/decode, merge, reducer, search | 1 |
| `src/features/vocab/api.ts` (+ test for the error mapping) | Supabase reads and writes for words | 2 |
| `src/features/vocab/useVocab.ts` | Lesson hook: load, reconnect reload, live stream, add/update/delete | 2 |
| `src/features/vocab/VocabForm.tsx` | Shared add/edit form | 2 |
| `src/features/vocab/VocabPanel.tsx` | In-lesson vocabulary list and form | 2 |
| `src/features/room/SidePanel.tsx` | Side panel frame with Chat / Vocabulary tabs | 3 |
| `src/features/chat/ChatPanel.tsx` | Becomes the chat body only (frame and header move to SidePanel) | 3 |
| `src/features/chat/notify.ts` (+ test) | `chatSeen` takes the active tab into account | 3 |
| `src/features/room/RoomShell.tsx` | Tab state, vocab hook, side panel wiring | 3 |
| `src/app/vocab/page.tsx` | Server page: all words | 4 |
| `src/features/vocab/VocabBook.tsx` | Search, hide-meaning quiz, edit, teacher add/delete | 4 |
| `src/features/chat/ChatBody.tsx` | Chat body text with links (moved out of ChatPanel) | 5 |
| `src/features/review/target.ts` (+ test) | Decides 404 / redirect / show for a review request | 5 |
| `src/features/review/ReviewBoard.tsx` | Read-only Excalidraw of a saved board | 5 |
| `src/app/lesson/[id]/review/page.tsx` | Review page | 5 |
| `src/features/usage/estimate.ts` (+ test) | Usage estimate | 6 |
| `src/features/usage/UsageMeter.tsx` | Meter bars | 6 |
| `src/app/page.tsx` | Vocabulary link, review links, usage meter | 4, 5, 6 |
| `src/lib/i18n/messages.ts` | New keys | every task |

---

### Task 1: Vocabulary table and model

**Files:**
- Create: `supabase/migrations/0007_vocab.sql`
- Create: `src/features/vocab/model.ts`
- Test: `src/features/vocab/model.test.ts`

**Interfaces:**
- Produces (exact names; later tasks rely on them):
  - Constants and types:
    - `VOCAB_TOPIC = 'ma-classe-vocab'`
    - `VOCAB_LIMITS = { french: 200, meaning: 500, example: 1000 }`
    - `type VocabWord = { id: string; lessonId: string | null; french: string; meaningVi: string; meaningEn: string; example: string; createdBy: string; createdAt: string; updatedAt: string }`
    - `type VocabDraft = { french: string; meaningVi: string; meaningEn: string; example: string }`
    - `type VocabRow` (the database columns)
  - Converters and validation:
    - `fromRow(r: VocabRow): VocabWord`
    - `prepareWord(d: VocabDraft): { ok: true; draft: VocabDraft } | { ok: false; reason: 'vocab.frenchRequired' | 'vocab.tooLong' }`
  - Wire format:
    - `type VocabWire = { v: 1; lessonId: string; op: 'upsert'; word: VocabWord } | { v: 1; lessonId: string; op: 'delete'; id: string }`
    - `encodeVocab(m: VocabWire): string`
    - `decodeVocab(text: string, lessonId: string): VocabWire | null`
  - State:
    - `mergeWords(a: readonly VocabWord[], b: readonly VocabWord[]): VocabWord[]`
    - `type VocabState = { words: VocabWord[]; deleted: ReadonlySet<string> }`
    - `type VocabAction = { type: 'loaded'; words: VocabWord[] } | { type: 'upsert'; word: VocabWord } | { type: 'delete'; id: string }`
    - `vocabReducer(s: VocabState, a: VocabAction): VocabState`
    - `initialVocab: VocabState`
  - Search:
    - `foldText(s: string): string`
    - `searchWords(words: readonly VocabWord[], query: string): VocabWord[]`

- [ ] **Step 1: Migration (USER ACTION: the user runs it in the Supabase SQL Editor)**

`supabase/migrations/0007_vocab.sql`:
```sql
-- Vocabulary: written by the teacher during a lesson (or on /vocab), editable by both members.
create table if not exists public.vocab (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references public.lessons (id) on delete set null,
  french text not null check (char_length(btrim(french)) between 1 and 200),
  meaning_vi text not null default '' check (char_length(meaning_vi) <= 500),
  meaning_en text not null default '' check (char_length(meaning_en) <= 500),
  example text not null default '' check (char_length(example) <= 1000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vocab_lesson on public.vocab (lesson_id, created_at);
create index if not exists vocab_created on public.vocab (created_at desc);

-- The server's clock decides which edit is newer; who wrote it and when it was created never change.
create or replace function public.vocab_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end $$;
drop trigger if exists vocab_touch on public.vocab;
create trigger vocab_touch before update on public.vocab for each row execute function public.vocab_touch();

alter table public.vocab enable row level security;
drop policy if exists vocab_read on public.vocab;
drop policy if exists vocab_insert on public.vocab;
drop policy if exists vocab_update on public.vocab;
drop policy if exists vocab_delete on public.vocab;
create policy vocab_read on public.vocab for select to authenticated using (public.is_member());
create policy vocab_insert on public.vocab for insert to authenticated
  with check (public.member_role() = 'teacher' and created_by = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy vocab_update on public.vocab for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy vocab_delete on public.vocab for delete to authenticated using (public.member_role() = 'teacher');
```

- [ ] **Step 2: Write the failing tests** in `src/features/vocab/model.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/features/vocab`
Expected: FAIL with "Failed to resolve import './model'".

- [ ] **Step 4: Implement `src/features/vocab/model.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/features/vocab`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_vocab.sql src/features/vocab/model.ts src/features/vocab/model.test.ts
git commit -m "feat(vocab): vocabulary table and model"
```

---

### Task 2: Vocabulary in the lesson (data layer and panel)

**Files:**
- Create: `src/features/vocab/api.ts`
- Test: `src/features/vocab/api.test.ts` (error mapping only)
- Create: `src/features/vocab/useVocab.ts`
- Create: `src/features/vocab/VocabForm.tsx`
- Create: `src/features/vocab/VocabPanel.tsx`
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes (Task 1): `VOCAB_TOPIC`, `VOCAB_COLUMNS`, `fromRow`, `prepareWord`, `encodeVocab`, `decodeVocab`, `vocabReducer`, `initialVocab`, `VocabWord`, `VocabDraft`, `VocabRow`.
- Consumes (existing):
  - `withTimeout(promise, ms, fallback)` from `@/features/board/retry`
  - `createBrowserSupabase()` from `@/lib/supabase/client`
  - `Member` from `@/lib/lessons/types`
  - `useRoomContext` from `@livekit/components-react`
  - `AccentBar` from `@/features/board/AccentBar`
  - `useT` from `@/lib/i18n/client`
- Produces:
  - Error type: `type VocabErrorKey = 'vocab.notReady' | 'vocab.notAllowed' | 'vocab.saveFailed'`.
  - `vocabErrorKey(error: { code?: string; message?: string } | null): VocabErrorKey`. Mapping:
    - `42P01` (undefined table) and `PGRST205` (table not in the schema cache) map to `vocab.notReady`.
    - `42501` and `PGRST301` (RLS or permission) map to `vocab.notAllowed`.
    - Anything else maps to `vocab.saveFailed`.
  - Result type: `type VocabResult<T> = { ok: true; value: T } | { ok: false; error: VocabErrorKey }`.
  - Data functions in `api.ts`:
    - `loadLessonWords(lessonId: string): Promise<VocabResult<VocabWord[]>>`
    - `insertWord(lessonId: string | null, draft: VocabDraft, email: string): Promise<VocabResult<VocabWord>>`
    - `updateWord(id: string, draft: VocabDraft): Promise<VocabResult<VocabWord>>`
    - `deleteWord(id: string): Promise<VocabResult<null>>`
    - Every call is wrapped in `withTimeout(…, 10_000, { ok: false, error: 'vocab.saveFailed' })`.
  - The hook: `useVocab(lessonId: string, member: Member, onIncoming?: (w: VocabWord) => void)` returns:
    - `{ words: VocabWord[]; status: 'loading' | 'ready' | VocabErrorKey; add(d: VocabDraft): Promise<VocabErrorKey | 'vocab.frenchRequired' | 'vocab.tooLong' | null>; update(id: string, d: VocabDraft): Promise<…same>; remove(id: string): Promise<VocabErrorKey | null> }`
  - Components:
    - `<VocabForm initial?: VocabDraft; submitLabel: string; onSubmit(d: VocabDraft): Promise<string | null>; onCancel?: () => void />`. `onSubmit` returns an i18n key for the error, or null.
    - `<VocabPanel words status member add update remove />`. It renders the list and form only, with no outer frame and no header. Task 3 puts it in the side panel.

- [ ] **Step 1: Write the failing test** `src/features/vocab/api.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabase: () => ({}) }));

import { vocabErrorKey } from './api';

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
```

Run: `npm test -- src/features/vocab/api`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/features/vocab/api.ts`**

```ts
import { withTimeout } from '@/features/board/retry';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { fromRow, VOCAB_COLUMNS, type VocabDraft, type VocabRow, type VocabWord } from './model';

export type VocabErrorKey = 'vocab.notReady' | 'vocab.notAllowed' | 'vocab.saveFailed';
export type VocabResult<T> = { ok: true; value: T } | { ok: false; error: VocabErrorKey };

const TIMEOUT_MS = 10_000;

export function vocabErrorKey(error: { code?: string; message?: string } | null): VocabErrorKey {
  const code = error?.code ?? '';
  if (code === '42P01' || code === 'PGRST205') return 'vocab.notReady';
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
    const { data, error } = await createBrowserSupabase().from('vocab').update(toRow(draft)).eq('id', id).select(VOCAB_COLUMNS).single();
    return error || !data ? { ok: false, error: vocabErrorKey(error) } : { ok: true, value: fromRow(data as VocabRow) };
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
```

Run: `npm test -- src/features/vocab`
Expected: PASS.

- [ ] **Step 3: Implement `src/features/vocab/useVocab.ts`**

It follows `src/features/chat/useChat.ts`. Read that file first, and mirror its structure (`useEffectEvent`, the text-stream handler with cleanup, the `Reconnected` reload).

```ts
'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useReducer, useState } from 'react';
import type { Member } from '@/lib/lessons/types';
import { deleteWord, insertWord, loadLessonWords, updateWord, type VocabErrorKey } from './api';
import { decodeVocab, encodeVocab, initialVocab, prepareWord, VOCAB_TOPIC, vocabReducer, type VocabDraft, type VocabWord } from './model';

type DraftError = VocabErrorKey | 'vocab.frenchRequired' | 'vocab.tooLong';

/** The lesson's words: database first, then the saved row goes to the other person over LiveKit. */
export function useVocab(lessonId: string, member: Member, onIncoming?: (w: VocabWord) => void) {
  const room = useRoomContext();
  const [state, dispatch] = useReducer(vocabReducer, initialVocab);
  const [status, setStatus] = useState<'loading' | 'ready' | VocabErrorKey>('loading');

  const applyLoad = useEffectEvent((r: Awaited<ReturnType<typeof loadLessonWords>>) => {
    if (r.ok) {
      dispatch({ type: 'loaded', words: r.value });
      setStatus('ready');
    } else {
      // Keep what is already listed after a failed reload; say why only when nothing is.
      setStatus((s) => (s === 'ready' ? s : r.error));
    }
  });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void loadLessonWords(lessonId).then((r) => {
        if (!cancelled) applyLoad(r);
      });
    load();
    room.on(RoomEvent.Reconnected, load);
    return () => {
      cancelled = true;
      room.off(RoomEvent.Reconnected, load);
    };
  }, [room, lessonId]);

  const receive = useEffectEvent((text: string) => {
    const m = decodeVocab(text, lessonId);
    if (!m) return;
    if (m.op === 'delete') dispatch({ type: 'delete', id: m.id });
    else {
      dispatch({ type: 'upsert', word: m.word });
      onIncoming?.(m.word);
    }
  });

  useEffect(() => {
    room.registerTextStreamHandler(VOCAB_TOPIC, async (reader) => {
      try {
        receive(await reader.readAll());
      } catch {
        // A broken stream is dropped; the next reload brings the row from the database.
      }
    });
    return () => room.unregisterTextStreamHandler(VOCAB_TOPIC);
  }, [room]);

  const broadcast = useCallback(
    (text: string) => void room.localParticipant.sendText(text, { topic: VOCAB_TOPIC }).catch(() => {}),
    [room],
  );

  const add = useCallback(
    async (d: VocabDraft): Promise<DraftError | null> => {
      const p = prepareWord(d);
      if (!p.ok) return p.reason;
      const r = await insertWord(lessonId, p.draft, member.email);
      if (!r.ok) return r.error;
      dispatch({ type: 'upsert', word: r.value });
      broadcast(encodeVocab({ v: 1, lessonId, op: 'upsert', word: r.value }));
      return null;
    },
    [lessonId, member.email, broadcast],
  );

  const update = useCallback(
    async (id: string, d: VocabDraft): Promise<DraftError | null> => {
      const p = prepareWord(d);
      if (!p.ok) return p.reason;
      const r = await updateWord(id, p.draft);
      if (!r.ok) return r.error;
      dispatch({ type: 'upsert', word: r.value });
      broadcast(encodeVocab({ v: 1, lessonId, op: 'upsert', word: r.value }));
      return null;
    },
    [lessonId, broadcast],
  );

  const remove = useCallback(
    async (id: string): Promise<VocabErrorKey | null> => {
      const r = await deleteWord(id);
      if (!r.ok) return r.error;
      dispatch({ type: 'delete', id });
      broadcast(encodeVocab({ v: 1, lessonId, op: 'delete', id }));
      return null;
    },
    [lessonId, broadcast],
  );

  return { words: state.words, status, add, update, remove };
}
```

Note: words are only ever shown after the database accepted them, so there is no "unsaved" state to show.

- [ ] **Step 4: Implement `src/features/vocab/VocabForm.tsx`**

`'use client'` component. State: one `VocabDraft`, initialised from `initial` or from empty strings, plus `error: string | null` and `busy: boolean`.

Fields, top to bottom, each a `<label>` with its `.field` input:
1. **French**, `vocab.french`: an `<input>` with `maxLength={200}`, `required` and `autoFocus` when `initial` is undefined, `lang="fr"`. Put `<AccentBar />` directly under it; it inserts into the focused input, as it does for chat.
2. **Vietnamese meaning**, `vocab.meaningVi`: `<input maxLength={500} lang="vi">`.
3. **English meaning**, `vocab.meaningEn`: `<input maxLength={500} lang="en">`.
4. **Example**, `vocab.example`: `<textarea rows={2} maxLength={1000} lang="fr">`.

Buttons:
- a primary `submitLabel` button, `disabled={busy}`;
- a `common.cancel` secondary button when `onCancel` is given.

On submit:
1. `preventDefault`.
2. `setBusy(true)` and `const key = await onSubmit(draft)`, then `setBusy(false)`.
3. If `key` is set, show it under the buttons as `<p role="alert" className="text-sm text-pen">`.
4. Otherwise, when `initial` is undefined (add mode), reset to empty fields and focus French.

- [ ] **Step 5: Implement `src/features/vocab/VocabPanel.tsx`**

`'use client'`. Props: `{ words: VocabWord[]; status: 'loading' | 'ready' | VocabErrorKey; member: Member; add; update; remove }`. These are the `useVocab` return values.

Layout: `flex min-h-0 flex-1 flex-col`.
- **Top**, teacher only: a collapsed **Add a word** button (`vocab.add`). It opens `<VocabForm submitLabel={t('vocab.save')} onSubmit={(d) => add(d)} onCancel={close} />`.
- **List** (`flex-1 overflow-y-auto px-3 py-3`):
  - Show the newest word first: render `[...words].reverse()`.
  - Each word is an `<article>`:
    - French in bold (`lang="fr"`);
    - the Vietnamese meaning (`lang="vi"`) and the English meaning (`lang="en"`), each on its own line and only if not empty;
    - the example in italic muted text (`lang="fr"`).
  - Each word has actions:
    - **Edit** (`vocab.edit`), for both members: swaps the article for a `VocabForm` with `initial` set and the `submitLabel` `vocab.save`.
    - **Delete** (`vocab.delete`), teacher only. It is a two-click confirmation: the first click turns the label into `vocab.confirmDelete`, and the label reverts after 4 s or on blur.
- **Empty and error states**, shown only when `words` is empty:
  - `status === 'loading'` → `vocab.loading`;
  - an error key → that key's text;
  - otherwise `member.role === 'teacher'` → `vocab.emptyTeacher`, and the student sees `vocab.emptyStudent`.
- **Write errors:** an error key returned from `update` or `remove` shows under that word as `<p role="alert">`.

- [ ] **Step 6: i18n keys** (add to both `en` and `fr` in `src/lib/i18n/messages.ts`)

| Key | EN | FR |
|---|---|---|
| `vocab.title` | Vocabulary | Vocabulaire |
| `vocab.add` | Add a word | Ajouter un mot |
| `vocab.french` | French | Français |
| `vocab.meaningVi` | Vietnamese meaning | Sens en vietnamien |
| `vocab.meaningEn` | English meaning | Sens en anglais |
| `vocab.example` | Example | Exemple |
| `vocab.save` | Save | Enregistrer |
| `vocab.edit` | Edit | Modifier |
| `vocab.delete` | Delete | Supprimer |
| `vocab.confirmDelete` | Click again to delete | Cliquez encore pour supprimer |
| `vocab.loading` | Loading the words… | Chargement des mots… |
| `vocab.emptyTeacher` | No words yet. Add the words from today’s lesson. | Aucun mot pour l’instant. Ajoutez les mots du cours d’aujourd’hui. |
| `vocab.emptyStudent` | No words yet. Words your teacher adds appear here. | Aucun mot pour l’instant. Les mots ajoutés par votre prof apparaissent ici. |
| `vocab.frenchRequired` | Write the French word. | Écrivez le mot en français. |
| `vocab.tooLong` | This is too long. Shorten it and save again. | C’est trop long. Raccourcissez et enregistrez à nouveau. |
| `vocab.notReady` | Vocabulary isn’t set up yet. Run migration 0007 in Supabase. | Le vocabulaire n’est pas encore prêt. Lancez la migration 0007 dans Supabase. |
| `vocab.notAllowed` | Only the teacher can add or delete words. | L’ajout et la suppression de mots sont réservés à votre prof. |
| `vocab.saveFailed` | Not saved. Check the connection and try again. | Non enregistré. Vérifiez la connexion et réessayez. |
| `common.cancel` | Cancel | Annuler |

`common.cancel` may already exist. If so, skip it.

- [ ] **Step 7: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass. The panel is not mounted anywhere yet; Task 3 mounts it.

```bash
git add src/features/vocab src/lib/i18n/messages.ts
git commit -m "feat(vocab): lesson vocabulary data layer, form and panel"
```

---

### Task 3: Chat and Vocabulary tabs in the lesson side panel

**Files:**
- Create: `src/features/room/SidePanel.tsx`
- Modify: `src/features/chat/ChatPanel.tsx`. Remove the outer `<section>` frame and the header, and keep the list and the form.
- Modify: `src/features/chat/notify.ts` and `src/features/chat/notify.test.ts`
- Modify: `src/features/room/RoomShell.tsx`
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes (Task 2):
  - `useVocab(lessonId, member, onIncoming)`
  - `<VocabPanel … />`
- Consumes (existing):
  - `chatSeen({ open, hidden })` from `notify.ts`
  - `ChatPanel` props
  - In RoomShell: `docked`, `chatOpen`, `overlayOpen`, `dockFolded`, `closeChat`, `toggleChat`, `markRead`
- Produces:
  - `chatSeen({ open, hidden, tab }: { open: boolean; hidden: boolean; tab?: 'chat' | 'vocab' }): boolean`. It is true only when the panel is open, the tab is visible, and the tab is `'chat'` (or `tab` is undefined, for compatibility).
  - `type SideTab = 'chat' | 'vocab'`.
  - `<SidePanel>` with these props:
    - `open: boolean`
    - `docked: boolean`
    - `tab: SideTab`
    - `onTab(t: SideTab): void`
    - `chatUnread: number`
    - `vocabNew: boolean`
    - `muted: boolean`
    - `onToggleMuted(): void`
    - `onClose(): void`
    - `children: ReactNode`

- [ ] **Step 1: Failing test** in `src/features/chat/notify.test.ts`. Add:

```ts
it('the chat counts as seen only while its tab is the one shown', () => {
  expect(chatSeen({ open: true, hidden: false, tab: 'chat' })).toBe(true);
  expect(chatSeen({ open: true, hidden: false, tab: 'vocab' })).toBe(false);
  expect(chatSeen({ open: true, hidden: true, tab: 'chat' })).toBe(false);
  expect(chatSeen({ open: false, hidden: false, tab: 'chat' })).toBe(false);
  expect(chatSeen({ open: true, hidden: false })).toBe(true);
});
```

Run: `npm test -- src/features/chat/notify`
Expected: FAIL. `tab: 'vocab'` still returns true, and `tsc` rejects the extra property.

- [ ] **Step 2: Update `chatSeen`** in `src/features/chat/notify.ts`

The signature becomes `({ open, hidden, tab = 'chat' }: { open: boolean; hidden: boolean; tab?: 'chat' | 'vocab' })`, and it returns `open && !hidden && tab === 'chat'`.

Run: `npm test -- src/features/chat/notify`
Expected: PASS.

- [ ] **Step 3: Create `SidePanel.tsx` and slim down `ChatPanel`**

- **The frame.** Move the outer `<section>` (with its docked and overlay class names, `hidden={!open}` and `aria-label`) and the header out of `ChatPanel` into `SidePanel`. Use the same classes as `ChatPanel.tsx` has today.
- **The header** is a `role="tablist"` with two `role="tab"` buttons, Chat (`chat.title`) and Vocabulary (`vocab.title`):
  - Set `aria-selected` and `aria-controls` on each tab.
  - Left and right arrow keys move between the tabs.
  - The active tab gets a 2px `border-pen` underline.
  - A small `bg-pen` dot (with an sr-only `side.unread` label) appears on Chat when `chatUnread > 0` and the tab is not active, and on Vocabulary when `vocabNew` is true.
- **Header buttons:** the mute button shows only when the Chat tab is active, and the Close button only when not docked. Both keep their current behaviour and labels.
- **The body** is `<div role="tabpanel" className="flex min-h-0 flex-1 flex-col">{children}</div>`.
- **`ChatPanel`** keeps its list and form, with the same focus and stick-to-bottom behaviour. It loses these props: `open` (keep a `visible` boolean if its scroll and focus effects need it), `onClose`, `muted`, `onToggleMuted` and `docked`.

- [ ] **Step 4: Wire it in `RoomShell.tsx`**

1. Add `const [sideTab, setSideTab] = useState<SideTab>('chat');`.
2. Change the `seen` line to `chatSeen({ open: chatOpen, hidden: tabHidden, tab: sideTab })`. The existing `markRead`, toast, ding and title effects then follow the active tab automatically.
3. Add `const vocab = useVocab(lessonId, member, (w) => { if (!(chatOpen && sideTab === 'vocab')) setVocabNew(true); });` and `const [vocabNew, setVocabNew] = useState(false);`. Clear `vocabNew` when the Vocabulary tab becomes visible (`chatOpen && sideTab === 'vocab'`).
4. In `openChatFromToast`, call `setSideTab('chat')` so a toast click always shows the chat.
5. Replace the `chatPanel` element with:
```tsx
<SidePanel
  open={chatOpen}
  docked={docked}
  tab={sideTab}
  onTab={setSideTab}
  chatUnread={seen ? 0 : chat.unread}
  vocabNew={vocabNew}
  muted={chatMuted}
  onToggleMuted={toggleChatMuted}
  onClose={closeChat}
>
  {sideTab === 'chat' ? (
    <ChatPanel …existing data props… />
  ) : (
    <VocabPanel words={vocab.words} status={vocab.status} member={member} add={vocab.add} update={vocab.update} remove={vocab.remove} />
  )}
</SidePanel>
```
6. The control bar's Chat button and its unread badge keep working as today. The badge still counts chat messages only.

- [ ] **Step 5: i18n keys**

| Key | EN | FR |
|---|---|---|
| `side.unread` | New | Nouveau |

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

Manual check with `npm run dev` (port 3000), as the teacher in a lesson, on the board stage at a width of at least 1024px:
- The docked panel shows the Chat and Vocabulary tabs.
- Adding a word shows it at once.
- Switching to Chat keeps the draft.
- While the Vocabulary tab is shown, a chat message from the other person gives a toast and a dot on the Chat tab.

- [ ] **Step 7: Commit**

```bash
git add src/features/room src/features/chat src/lib/i18n/messages.ts
git commit -m "feat(room): chat and vocabulary tabs in the lesson side panel"
```

---

### Task 4: The /vocab page

**Files:**
- Create: `src/app/vocab/page.tsx`
- Create: `src/features/vocab/VocabBook.tsx`
- Modify: `src/app/page.tsx` (header link)
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes (Tasks 1–2):
  - `fromRow`, `VOCAB_COLUMNS`, `searchWords`, `VocabWord`, `VocabRow`
  - `insertWord`, `updateWord`, `deleteWord`
  - `VocabForm`
- Consumes (existing):
  - `getMember`, `createClient` (server)
  - `getLocale`, `getT`, `getTimeZone`, `getThemePref`
  - `formatLessonDate`
  - `Wordmark`, `ThemeSwitch`, `LanguageSwitch`
- Produces:
  - Route `/vocab`.
  - `<VocabBook initial: VocabWord[]; lessonDates: Record<string, string>; member: Member />`.

- [ ] **Step 1: Server page** `src/app/vocab/page.tsx`

Follow `src/app/documents/page.tsx`, with the same header (the `Wordmark` linking to `/`, `ThemeSwitch` and `LanguageSwitch`).
- Export `metadata: { title: 'Vocabulary · Ma Classe' }`.
- Call `getMember()`. When there is no member, call `redirect('/login?denied=1')`.
- Load `vocab` (`VOCAB_COLUMNS`, ordered by `created_at` descending) and `lessons(id, started_at)` in parallel.
- **On a vocab error:**
  - If the code is `42P01` or `PGRST205`, render the page with a `vocab.notReady` notice instead of the book. This means migration 0007 has not run yet.
  - Any other error throws `new Error('Could not load the vocabulary', { cause })`.
- **On a lessons error**, throw.
- Build `lessonDates[id] = formatLessonDate(started_at, locale, timeZone)`.
- Render `<h1 className="font-display text-3xl font-bold">{t('vocab.title')}</h1>` and `<VocabBook initial={words} lessonDates={lessonDates} member={member} />`.

- [ ] **Step 2: `VocabBook.tsx`** (`'use client'`)

**State:**
- `words`, initialised from `initial`;
- `query`;
- `hide`, a boolean read from `localStorage['ma-classe:vocab-hide']`. Both the read and the write go inside `try/catch`, and the value defaults to false.
- `revealed: Set<string>`, cleared whenever `hide` changes;
- `editing: string | null`;
- `adding: boolean`, teacher only.

**Layout:**
1. **A toolbar row:**
   - a search `<input type="search" className="field">` with `aria-label` and placeholder `vocab.search`;
   - a toggle `<button aria-pressed={hide}>` labelled `vocab.hideMeanings`;
   - a count, `vocab.count` with `{n}` set to the number of shown words.
   - Teacher only: an **Add a word** button (`vocab.add`) that opens `VocabForm`. Its submit calls `insertWord(null, d, member.email)`, prepends the saved word, and returns `null` or the error key. The submit first runs `prepareWord`, and returns `p.reason` when it fails.
2. **A list** of `searchWords(words, query)`, newest first:
   - each word shows French in bold;
   - under it, the lesson date (`lessonDates[lessonId]`), or `vocab.noLesson` when `lessonId` is null or the lesson is unknown.
3. **When `hide` is on and the word is not in `revealed`:**
   - the meanings and the example are replaced by a `vocab.show` button that adds the id to `revealed`;
   - when it is clicked, focus moves to the revealed text container (`tabIndex={-1}`).
4. **Edit** (both members) and **Delete** (teacher, with the two-click confirmation) work like `VocabPanel`. Use `updateWord` and `deleteWord`, then replace or remove the word in the local list. Show the error key under the word.
5. **Empty states:**
   - no words at all: `vocab.bookEmpty`;
   - no match for the search: `vocab.noMatch`.

- [ ] **Step 3: Home link**

In `src/app/page.tsx`, add this next to the Documents link:
```tsx
<Link href="/vocab" className="btn btn-secondary btn-sm">
  {t('vocab.title')}
</Link>
```

- [ ] **Step 4: i18n keys**

| Key | EN | FR |
|---|---|---|
| `vocab.search` | Search words and meanings | Rechercher un mot ou un sens |
| `vocab.hideMeanings` | Hide meanings | Masquer les sens |
| `vocab.show` | Show meaning | Voir le sens |
| `vocab.count` | {n} words | {n} mots |
| `vocab.noLesson` | Added outside a lesson | Ajouté hors cours |
| `vocab.bookEmpty` | No words yet. Words added during lessons appear here. | Aucun mot pour l’instant. Les mots ajoutés pendant les cours apparaissent ici. |
| `vocab.noMatch` | No word matches this search. | Aucun mot ne correspond à cette recherche. |

- [ ] **Step 5: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

```bash
git add src/app/vocab src/features/vocab/VocabBook.tsx src/app/page.tsx src/lib/i18n/messages.ts
git commit -m "feat(vocab): vocabulary page with search and hide-meaning quiz"
```

---

### Task 5: Past-lesson review page

**Files:**
- Create: `src/features/review/target.ts` and test `src/features/review/target.test.ts`
- Create: `src/features/chat/ChatBody.tsx` (move `Body` out of `ChatPanel.tsx`)
- Modify: `src/features/chat/ChatPanel.tsx` (import `ChatBody`)
- Create: `src/features/review/ReviewBoard.tsx`
- Create: `src/features/review/ReviewBoardLoader.tsx` (`'use client'`; `export const ReviewBoardLoader = dynamic(() => import('./ReviewBoard'), { ssr: false })` — `ReviewBoard` is the default export)
- Create: `src/app/lesson/[id]/review/page.tsx`
- Modify: `src/app/page.tsx` (past lessons link to their review)
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes (existing):
  - `isUuid` from `@/features/documents/params`
  - `loadBoard(lessonId)` and `loadFiles(ids)` from `@/features/board/persistence`
  - `sceneFileIds(elements)` from `@/features/board/files`
  - `downloadAsDataURL(path, mime)` from `@/features/board/upload`
  - `formatChatTime`
  - `fromRow`, `VOCAB_COLUMNS`
  - Board.tsx's `useThemeName` pattern (read it, and export it if it is not exported)
- Produces:
  - `reviewTarget(id: string, lesson: { status: 'live' | 'ended' } | null): 'not-found' | 'live' | 'show'`
  - `<ChatBody text: string />`
  - `<ReviewBoard lessonId: string />`
  - Route `/lesson/[id]/review`

- [ ] **Step 1: Failing test** `src/features/review/target.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { reviewTarget } from './target';

const ID = '11111111-1111-4111-8111-111111111111';

describe('reviewTarget', () => {
  it('a malformed id or an unknown lesson is not found', () => {
    expect(reviewTarget('nope', null)).toBe('not-found');
    expect(reviewTarget(ID, null)).toBe('not-found');
  });
  it('a live lesson goes to the room', () => {
    expect(reviewTarget(ID, { status: 'live' })).toBe('live');
  });
  it('an ended lesson is shown', () => {
    expect(reviewTarget(ID, { status: 'ended' })).toBe('show');
  });
});
```

Run: `npm test -- src/features/review`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/features/review/target.ts`**

```ts
import { isUuid } from '@/features/documents/params';

/** What the review page does for this id: 404, send a live lesson to its room, or show it. */
export function reviewTarget(id: string, lesson: { status: 'live' | 'ended' } | null): 'not-found' | 'live' | 'show' {
  if (!isUuid(id) || !lesson) return 'not-found';
  return lesson.status === 'live' ? 'live' : 'show';
}
```

Run: `npm test -- src/features/review`
Expected: PASS.

- [ ] **Step 3: Move `ChatBody`**

Move the `Body` function from `ChatPanel.tsx` into `src/features/chat/ChatBody.tsx` as `export function ChatBody({ text }: { text: string })`. Keep the code unchanged: text nodes and `linkify` links only. Leave out `'use client'` so server pages can render it. Then import it in `ChatPanel`.

- [ ] **Step 4: `ReviewBoard.tsx`** (`'use client'`)

- **Imports:** import `Excalidraw` and `restoreElements` from `@excalidraw/excalidraw`, plus `@excalidraw/excalidraw/index.css`.
- **Theme:** use the same theme hook as `Board.tsx`.
- **States:** `'loading' | 'empty' | 'ready' | 'failed'`.
- **On mount:**
  1. Call `loadBoard(lessonId)`. If it throws, set `failed`. If it returns no live (non-deleted) elements, set `empty`.
  2. Otherwise render
     ```tsx
     <Excalidraw
       initialData={{ elements: restoreElements(elements, null), scrollToContent: true }}
       viewModeEnabled
       zenModeEnabled
       theme={theme}
       excalidrawAPI={setApi}
       UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } }}
     />
     ```
  3. Once `api` is set, call `loadFiles(sceneFileIds(elements))`. Then, for each file, call `downloadAsDataURL(f.storage_path, f.mime)` followed by `api.addFiles([{ id, dataURL, mimeType, created: Date.now() }])`, the same way `Board.tsx` adds files.
  4. A failed image stays a placeholder. It does not fail the page.
  5. Ignore results that arrive after unmount by keeping a `cancelled` flag.
- **Container:** `className="h-[70vh] min-h-80 overflow-hidden rounded-xl border border-line"`.
- **Notes for the other states:** `review.boardLoading`, `review.boardEmpty` and `review.boardFailed`.

- [ ] **Step 5: Review page** `src/app/lesson/[id]/review/page.tsx` (server)

1. Read `params: Promise<{ id: string }>` and await it, following the Next 16 docs in `node_modules/next/dist/docs/`.
2. Call `getMember()`. With no member, `redirect('/login?denied=1')`.
3. If `!isUuid(id)`, call `notFound()`. Otherwise load the lesson: `select('id, status, started_at, ended_at').eq('id', id).maybeSingle()`.
4. Apply `reviewTarget(id, lesson)`:
   - `not-found` → `notFound()`;
   - `live` → `redirect(\`/lesson/${id}\`)`.
5. In parallel, load:
   - the chat: `select('id, author_email, author_name, body, created_at').eq('lesson_id', id).order('created_at')`;
   - the vocab: `select(VOCAB_COLUMNS).eq('lesson_id', id).order('created_at')`.
6. A vocab error with code `42P01` or `PGRST205` means an empty list. Any other error throws.
7. Render, in `max-w-5xl`, with the same header as `/documents`:
   - `<h1>`: `lesson.title` with `{date}`, then a muted `home.minutes` duration.
   - `<section aria-labelledby>` **Board** (`review.board`): `<ReviewBoard lessonId={id} />`. Render it as `<ReviewBoardLoader lessonId={id} />`, because `dynamic` with `ssr: false` must be called from a client component.
   - Below the board, a two-column grid (`grid gap-6 lg:grid-cols-2`) of two `.card` sections:
     - **Chat** (`chat.title`): each message shows the author name, the time and `<ChatBody text={m.body} />`. Format the time with `formatChatTime(m.created_at, new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }))`. When there are no messages, show `review.noChat`.
     - **Vocabulary** (`vocab.title`): each word shows French, then the meanings, then the example (read-only). When there are no words, show `review.noVocab`.
8. Export `generateMetadata`, returning `{ title: 'Review · Ma Classe' }`.

- [ ] **Step 6: Home links**

In `src/app/page.tsx`, wrap each past lesson's row content in `<Link href={\`/lesson/${l.id}/review\`} className="flex flex-1 items-baseline justify-between gap-4 px-5 py-3.5 hover:bg-surface-2">`. The whole row is the link. Move the padding from the `<li>` to the link.

- [ ] **Step 7: i18n keys**

| Key | EN | FR |
|---|---|---|
| `review.board` | Board | Tableau |
| `review.boardLoading` | Loading the board… | Chargement du tableau… |
| `review.boardEmpty` | Nothing was written on the board in this lesson. | Rien n’a été écrit au tableau pendant ce cours. |
| `review.boardFailed` | The board couldn’t load. Reload the page to try again. | Le tableau n’a pas pu se charger. Rechargez la page pour réessayer. |
| `review.noChat` | No messages in this lesson. | Aucun message pendant ce cours. |
| `review.noVocab` | No words were added in this lesson. | Aucun mot n’a été ajouté pendant ce cours. |

- [ ] **Step 8: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass. Then check by hand:
- an ended lesson's review page shows its board read-only, with images;
- `/lesson/not-a-uuid/review` gives 404;
- the live lesson's review URL redirects to the room.

```bash
git add src/features/review src/features/chat src/app/lesson src/app/page.tsx src/lib/i18n/messages.ts
git commit -m "feat(review): read-only review page for past lessons"
```

---

### Task 6: Usage meter

**Files:**
- Create: `src/features/usage/estimate.ts` and test `src/features/usage/estimate.test.ts`
- Create: `src/features/usage/UsageMeter.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Produces:
  - `FREE_LIMITS = { participantMinutes: 5000, downstreamBytes: 50 * 1e9, storageBytes: 1024 ** 3 }`.
  - `BITRATE_MBPS = 0.8`. This is the 540p estimate: 1,800 participant-minutes × 0.8 Mbit/s ≈ 10.8 GB, which matches spec §4's ~11 GB.
  - `MAX_LESSON_MS = 4 * 60 * 60 * 1000`, the token TTL.
  - `monthStart(now: Date): Date`, the first instant of the current UTC month.
  - `estimateUsage({ lessons, fileBytes, now }: { lessons: { started_at: string; ended_at: string | null }[]; fileBytes: number[]; now: Date }): Usage`.
  - `type UsageItem = { key: 'minutes' | 'data' | 'storage'; used: number; limit: number; ratio: number; level: 'ok' | 'warn' | 'over' }`.
  - `type Usage = { items: UsageItem[]; warn: boolean }`.
  - `<UsageMeter usage: Usage | null />`. `null` means the data could not be loaded.

- [ ] **Step 1: Failing tests** `src/features/usage/estimate.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { estimateUsage, FREE_LIMITS, monthStart } from './estimate';

const now = new Date('2026-10-20T12:00:00.000Z');
const get = (u: ReturnType<typeof estimateUsage>, k: 'minutes' | 'data' | 'storage') => u.items.find((i) => i.key === k)!;

describe('monthStart', () => {
  it('is the first instant of the UTC month', () => {
    expect(monthStart(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('estimateUsage', () => {
  it('counts lesson minutes × 2 participants', () => {
    const u = estimateUsage({ lessons: [{ started_at: '2026-10-05T10:00:00.000Z', ended_at: '2026-10-05T11:30:00.000Z' }], fileBytes: [], now });
    expect(get(u, 'minutes').used).toBe(180);
    expect(get(u, 'minutes').limit).toBe(FREE_LIMITS.participantMinutes);
  });
  it('estimates data at 0.8 Mbit/s per participant-minute', () => {
    const u = estimateUsage({ lessons: [{ started_at: '2026-10-05T10:00:00.000Z', ended_at: '2026-10-05T11:30:00.000Z' }], fileBytes: [], now });
    expect(get(u, 'data').used).toBe(180 * 60 * 0.1e6);
  });
  it('counts only the part of a lesson inside this month', () => {
    const u = estimateUsage({ lessons: [{ started_at: '2026-09-30T23:30:00.000Z', ended_at: '2026-10-01T00:30:00.000Z' }], fileBytes: [], now });
    expect(get(u, 'minutes').used).toBe(60);
  });
  it('a lesson still live counts up to now, but no lesson counts past 4 hours', () => {
    const live = estimateUsage({ lessons: [{ started_at: '2026-10-20T11:00:00.000Z', ended_at: null }], fileBytes: [], now });
    expect(get(live, 'minutes').used).toBe(120);
    const forgotten = estimateUsage({ lessons: [{ started_at: '2026-10-02T08:00:00.000Z', ended_at: null }], fileBytes: [], now });
    expect(get(forgotten, 'minutes').used).toBe(480);
  });
  it('ignores lessons that ended before this month or have nonsense times', () => {
    const u = estimateUsage({
      lessons: [
        { started_at: '2026-09-02T10:00:00.000Z', ended_at: '2026-09-02T11:00:00.000Z' },
        { started_at: 'bad', ended_at: null },
        { started_at: '2026-10-05T11:00:00.000Z', ended_at: '2026-10-05T10:00:00.000Z' },
      ],
      fileBytes: [],
      now,
    });
    expect(get(u, 'minutes').used).toBe(0);
  });
  it('storage is the sum of file sizes', () => {
    expect(get(estimateUsage({ lessons: [], fileBytes: [100, 250], now }), 'storage').used).toBe(350);
  });
  it('warns at 70% and flags over 100%', () => {
    const at70 = estimateUsage({ lessons: [], fileBytes: [0.71 * FREE_LIMITS.storageBytes], now });
    expect(get(at70, 'storage').level).toBe('warn');
    expect(at70.warn).toBe(true);
    const over = estimateUsage({ lessons: [], fileBytes: [1.2 * FREE_LIMITS.storageBytes], now });
    expect(get(over, 'storage').level).toBe('over');
    expect(get(over, 'storage').ratio).toBeCloseTo(1.2);
    expect(estimateUsage({ lessons: [], fileBytes: [10], now }).warn).toBe(false);
  });
});
```

Run: `npm test -- src/features/usage`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/features/usage/estimate.ts`**

```ts
/** Free plan limits (spec §4): LiveKit Build per month, Supabase Free file storage. */
export const FREE_LIMITS = { participantMinutes: 5000, downstreamBytes: 50 * 1e9, storageBytes: 1024 ** 3 } as const;
/** 540p camera with simulcast: 1,800 participant-minutes × 0.8 Mbit/s ≈ 11 GB, as spec §4 expects. */
export const BITRATE_MBPS = 0.8;
/** A LiveKit token lasts 4 hours, so no lesson can use more; a lesson left live by mistake counts that much at most. */
export const MAX_LESSON_MS = 4 * 60 * 60 * 1000;
const WARN_AT = 0.7;
const PARTICIPANTS = 2;

export type UsageItem = { key: 'minutes' | 'data' | 'storage'; used: number; limit: number; ratio: number; level: 'ok' | 'warn' | 'over' };
export type Usage = { items: UsageItem[]; warn: boolean };

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

function item(key: UsageItem['key'], used: number, limit: number): UsageItem {
  const ratio = used / limit;
  return { key, used, limit, ratio, level: ratio >= 1 ? 'over' : ratio >= WARN_AT ? 'warn' : 'ok' };
}

export function estimateUsage({
  lessons,
  fileBytes,
  now,
}: {
  lessons: readonly { started_at: string; ended_at: string | null }[];
  fileBytes: readonly number[];
  now: Date;
}): Usage {
  const from = monthStart(now).getTime();
  const to = now.getTime();
  let ms = 0;
  for (const l of lessons) {
    const start = Date.parse(l.started_at);
    if (Number.isNaN(start)) continue;
    const rawEnd = l.ended_at ? Date.parse(l.ended_at) : to;
    if (Number.isNaN(rawEnd)) continue;
    const end = Math.min(rawEnd, start + MAX_LESSON_MS, to);
    const counted = end - Math.max(start, from);
    if (counted > 0) ms += counted;
  }
  const participantMinutes = Math.round((ms / 60000) * PARTICIPANTS);
  const dataBytes = participantMinutes * 60 * ((BITRATE_MBPS * 1e6) / 8);
  const storage = fileBytes.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  const items = [
    item('minutes', participantMinutes, FREE_LIMITS.participantMinutes),
    item('data', dataBytes, FREE_LIMITS.downstreamBytes),
    item('storage', storage, FREE_LIMITS.storageBytes),
  ];
  return { items, warn: items.some((i) => i.level !== 'ok') };
}
```

Run: `npm test -- src/features/usage`
Expected: PASS.

- [ ] **Step 3: `UsageMeter.tsx`** (server component, no `'use client'`)

Props: `{ usage: Usage | null; t: Awaited<ReturnType<typeof getT>>; locale: Locale }`. Pass in the server `t` from `getT()`. Import `getT` as a type from `@/lib/i18n/server`, and `Locale` from `@/lib/i18n/messages`.

Render a `.card` section with:
- `<h2>` `usage.title`, and a muted line `usage.note`;
- one row per item:
  - the label (`usage.minutes` / `usage.data` / `usage.storage`);
  - the amounts, formatted with `Intl.NumberFormat(locale)`:
    - minutes as an integer;
    - data in GB with 1 decimal (`used / 1e9`);
    - storage in MB with an integer (`used / 1024 ** 2`), against `1 GB`;
  - a bar `<div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))} aria-label={label}>`:
    - its fill width is `min(100, ratio × 100)%`;
    - its colour depends on the level: `bg-good` for ok, `bg-warn` for warn and `bg-pen` for over. Use the existing colour tokens in `globals.css`; if a `warn` token does not exist, use the amber the status bar uses.
  - **warn / over levels:** also show the text `usage.warn` / `usage.over` next to the bar, so the level is never shown by colour alone.
- when `usage` is `null`, only the heading and `usage.unavailable`.

- [ ] **Step 4: Home page**

In `src/app/page.tsx`, after the past-lessons section, load the data in parallel with the existing query:
```ts
const since = monthStart(new Date()).toISOString();
const [usageLessons, usageFiles] = await Promise.all([
  supabase.from('lessons').select('started_at, ended_at').or(`ended_at.is.null,ended_at.gte.${since}`),
  supabase.from('files').select('size_bytes'),
]);
const usage =
  usageLessons.error || usageFiles.error
    ? null
    : estimateUsage({
        lessons: usageLessons.data ?? [],
        fileBytes: (usageFiles.data ?? []).map((f) => Number(f.size_bytes)),
        now: new Date(),
      });
```
Render `<UsageMeter usage={usage} t={t} locale={locale} />` as the last section.

The meter is secondary: its load errors never throw, and the home page still works without it.

- [ ] **Step 5: i18n keys**

| Key | EN | FR |
|---|---|---|
| `usage.title` | This month’s free usage | Utilisation gratuite ce mois-ci |
| `usage.note` | Estimated from lesson times. The free plans reset each month. | Estimation d’après la durée des cours. Les offres gratuites repartent à zéro chaque mois. |
| `usage.minutes` | Video minutes | Minutes de vidéo |
| `usage.data` | Video data | Données vidéo |
| `usage.storage` | File storage | Stockage des fichiers |
| `usage.warn` | Over 70%: keep an eye on it | Plus de 70 % : à surveiller |
| `usage.over` | Free limit reached | Limite gratuite atteinte |
| `usage.unavailable` | Usage couldn’t load. It will show again on the next visit. | L’utilisation n’a pas pu se charger. Elle s’affichera à la prochaine visite. |

- [ ] **Step 6: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

```bash
git add src/features/usage src/app/page.tsx src/lib/i18n/messages.ts
git commit -m "feat(usage): free usage meter on the home page"
```

---

## After Plan 5

- The user runs migration 0007 in the Supabase SQL Editor before using vocabulary.
- **Manual check with two people:**
  1. The teacher adds a word in a lesson, and the student sees it live.
  2. The student edits the meaning, and the teacher sees the change.
  3. The student is refused when adding a word.
  4. `/vocab` search with and without accents.
  5. The hide-meaning quiz.
  6. A past lesson's review page shows the board with images, the chat and the words.
  7. The usage meter matches the lesson times.
