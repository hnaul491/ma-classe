# Ma Classe — Plan 3: Chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lesson chat in the call. Messages appear instantly for both people, are saved with the lesson, and support French accents and clickable links.

**Architecture:** One `chat` table in Supabase is the record. When you send a message:
1. Your browser inserts the row through RLS.
2. It broadcasts the same message over LiveKit `sendText` on the topic `ma-classe-chat`, so the other person sees it instantly.

On opening the room, each browser loads the lesson's history. Pure helpers merge messages by id, so a message that arrives both live and from the database appears once. The chat is a panel that slides in from the right, opened with a Chat button in the control bar. It shows an unread dot while closed.

**Tech Stack:** Next.js 16.4, React 19, `livekit-client` 2.22.4, `@supabase/supabase-js` 2.117.3, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-10-ma-classe-design.md` §5 (layout B: Chat slides in from the right; C/D/E: Chat tab), §9 (chat topic), §10 (`chat` table). Moved ahead of Drive/media at the user's request.

## Global Constraints

- **Who can do what:** either member sends; only members read (RLS).
- **Message body:** 1–2000 characters, trimmed, kept as plain text (never rendered as HTML).
- **Links:** `http(s)://` links are clickable and open in a new tab with `rel="noopener noreferrer"`.
- **Composer keys:** Enter sends; Shift+Enter adds a new line.
- **Accents:** the accent bar types into the chat box. The existing `AccentBar` already targets any focused text input or textarea.
- **Copy:** all UI copy is in EN and FR (gender-neutral French) and goes through `messages.ts`, using the shared `.btn`, `.field` and `.card` classes.
- **Hygiene:** exact package versions (no new dependencies are expected), pristine tests, 0 lint errors.

**User action:** run `supabase/migrations/0005_chat.sql` in the Supabase SQL Editor.

## Review Focus

1. **The same message arriving twice** (live and from history, or after a reconnect) shows once, in time order. Pinned by `mergeMessages` tests.
2. **Text that looks like HTML** (`<b>hi</b>`, `<script>`) is shown literally, never interpreted. Pinned by `linkify` tests: the output is segments, not HTML.
3. **An empty or whitespace-only message, or one over 2000 characters,** is not sent, and the user sees why. Pinned by `prepareMessage` tests.
4. **A message sent while the database is down** is still shown to both people, and the sender sees "Not saved". Pinned by the `ChatPanel` send path and its `status` on the message.
5. **Pressing Enter while an IME composition is active** (for example Vietnamese input) does not send. Pinned by `shouldSendOnKey` tests.

---

### Task 1: Chat table, protocol and pure helpers

**Files:**
- Create: `supabase/migrations/0005_chat.sql`
- Create: `src/features/chat/model.ts`
- Test: `src/features/chat/model.test.ts`

**Interfaces (produces):**
- Table `public.chat(id uuid pk, lesson_id uuid fk, author_email text, author_name text, body text check 1..2000, created_at timestamptz)` with RLS: members can select and insert. Inserts require `author_email = auth email`.
- `CHAT_TOPIC = 'ma-classe-chat'`
- `MAX_CHAT = 2000`
- `type ChatMessage = { id: string; lessonId: string; authorEmail: string; authorName: string; body: string; createdAt: string; status?: 'sending' | 'saved' | 'unsaved' }`
- `prepareMessage(raw: string): { ok: true; body: string } | { ok: false; reason: 'chat.empty' | 'chat.tooLong' }`
- `encodeChat(m: ChatMessage): string`
- `decodeChat(text: string, lessonId: string): ChatMessage | null`
- `mergeMessages(a: readonly ChatMessage[], b: readonly ChatMessage[]): ChatMessage[]`: dedupes by id. A `saved` status wins over `sending` or `unsaved`. Output is sorted by `createdAt`, then `id`.
- `type Segment = { kind: 'text'; text: string } | { kind: 'link'; href: string; text: string }`
- `linkify(body: string): Segment[]`
- `shouldSendOnKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean`

- [ ] **Step 1: Migration**

`supabase/migrations/0005_chat.sql`:
```sql
create table public.chat (
  id uuid primary key,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  author_email text not null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index chat_lesson_time on public.chat (lesson_id, created_at);

alter table public.chat enable row level security;
create policy chat_read on public.chat for select to authenticated using (public.is_member());
create policy chat_insert on public.chat for insert to authenticated
  with check (public.is_member() and author_email = lower(coalesce(auth.jwt() ->> 'email', '')));
```

- [ ] **Step 2: Failing tests**

`src/features/chat/model.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeChat, encodeChat, linkify, mergeMessages, prepareMessage, shouldSendOnKey, type ChatMessage } from './model';

const L = '11111111-1111-4111-8111-111111111111';
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: '22222222-2222-4222-8222-222222222222',
  lessonId: L,
  authorEmail: 's@x.fr',
  authorName: 'Luan',
  body: 'Bonjour',
  createdAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

describe('prepareMessage', () => {
  it('trims and accepts normal text', () => {
    expect(prepareMessage('  Salut !  ')).toEqual({ ok: true, body: 'Salut !' });
  });
  it('rejects empty or whitespace-only', () => {
    expect(prepareMessage('   \n ')).toEqual({ ok: false, reason: 'chat.empty' });
  });
  it('rejects over 2000 characters', () => {
    expect(prepareMessage('a'.repeat(2001))).toEqual({ ok: false, reason: 'chat.tooLong' });
    expect(prepareMessage('a'.repeat(2000)).ok).toBe(true);
  });
});

describe('encodeChat / decodeChat', () => {
  it('round-trips without the local status', () => {
    const m = msg({ status: 'sending' });
    const { status: _status, ...wire } = m;
    expect(decodeChat(encodeChat(m), L)).toEqual(wire);
  });
  it('rejects other lessons, bad versions, garbage and oversized bodies', () => {
    expect(decodeChat(encodeChat(msg({ lessonId: '33333333-3333-4333-8333-333333333333' })), L)).toBeNull();
    expect(decodeChat('{"v":2}', L)).toBeNull();
    expect(decodeChat('nope', L)).toBeNull();
    expect(decodeChat(encodeChat(msg({ body: 'a'.repeat(2001) })), L)).toBeNull();
    expect(decodeChat(encodeChat(msg({ id: 'not-a-uuid' })), L)).toBeNull();
  });
});

describe('mergeMessages', () => {
  it('shows a message once when it arrives live and from history', () => {
    const live = msg({ status: 'sending' });
    const saved = msg({ status: 'saved' });
    expect(mergeMessages([live], [saved])).toEqual([saved]);
    expect(mergeMessages([saved], [live])).toEqual([saved]);
  });
  it('sorts by time, then id', () => {
    const a = msg({ id: '22222222-2222-4222-8222-22222222222a', createdAt: '2026-10-10T10:00:02.000Z' });
    const b = msg({ id: '22222222-2222-4222-8222-22222222222b', createdAt: '2026-10-10T10:00:01.000Z' });
    expect(mergeMessages([a], [b]).map((m) => m.id)).toEqual([b.id, a.id]);
  });
});

describe('linkify', () => {
  it('turns http(s) links into link segments and keeps the rest as text', () => {
    expect(linkify('voir https://fr.wikipedia.org/wiki/Passé_composé, merci')).toEqual([
      { kind: 'text', text: 'voir ' },
      { kind: 'link', href: 'https://fr.wikipedia.org/wiki/Passé_composé', text: 'https://fr.wikipedia.org/wiki/Passé_composé' },
      { kind: 'text', text: ', merci' },
    ]);
  });
  it('never treats HTML or other schemes as links', () => {
    expect(linkify('<b>hi</b> javascript:alert(1)')).toEqual([{ kind: 'text', text: '<b>hi</b> javascript:alert(1)' }]);
  });
});

describe('shouldSendOnKey', () => {
  it('sends on Enter, not on Shift+Enter or while composing', () => {
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSendOnKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});
```

Run: `npm test -- src/features/chat`. Expected: FAIL.

- [ ] **Step 3: Implement** `src/features/chat/model.ts`:
```ts
export const CHAT_TOPIC = 'ma-classe-chat';
export const MAX_CHAT = 2000;

export type ChatMessage = {
  id: string;
  lessonId: string;
  authorEmail: string;
  authorName: string;
  body: string;
  createdAt: string;
  status?: 'sending' | 'saved' | 'unsaved';
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareMessage(raw: string): { ok: true; body: string } | { ok: false; reason: 'chat.empty' | 'chat.tooLong' } {
  const body = raw.trim();
  if (body.length === 0) return { ok: false, reason: 'chat.empty' };
  if (body.length > MAX_CHAT) return { ok: false, reason: 'chat.tooLong' };
  return { ok: true, body };
}

export function encodeChat(m: ChatMessage): string {
  const { status: _status, ...wire } = m;
  return JSON.stringify({ v: 1, ...wire });
}

export function decodeChat(text: string, lessonId: string): ChatMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== 1 || m.lessonId !== lessonId) return null;
  if (typeof m.id !== 'string' || !UUID.test(m.id)) return null;
  if (typeof m.authorEmail !== 'string' || typeof m.authorName !== 'string') return null;
  if (typeof m.body !== 'string' || m.body.length < 1 || m.body.length > MAX_CHAT) return null;
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) return null;
  return { id: m.id, lessonId, authorEmail: m.authorEmail, authorName: m.authorName, body: m.body, createdAt: m.createdAt };
}

const rank = (s: ChatMessage['status']) => (s === 'saved' ? 2 : s === undefined ? 1 : 0);

export function mergeMessages(a: readonly ChatMessage[], b: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...a, ...b]) {
    const prev = byId.get(m.id);
    if (!prev || rank(m.status) >= rank(prev.status)) byId.set(m.id, m);
  }
  return [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
}

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; href: string; text: string };

const LINK = /https?:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]]+$/;

export function linkify(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    let url = match[0];
    const trail = url.match(TRAILING)?.[0] ?? '';
    url = url.slice(0, url.length - trail.length);
    const start = match.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    out.push({ kind: 'link', href: url, text: url });
    last = start + url.length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  // Merge adjacent text segments (trailing punctuation splits them).
  return out.reduce<Segment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev?.kind === 'text' && s.kind === 'text') prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

export function shouldSendOnKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing;
}
```

Run the tests again. Expected: PASS. Then commit: `feat(chat): chat table, wire format and message helpers`.

---

### Task 2: Chat panel in the room

**Files:**
- Create: `src/features/chat/useChat.ts`
- Create: `src/features/chat/ChatPanel.tsx`
- Modify: `src/features/room/ControlBar.tsx` (Chat button and unread dot)
- Modify: `src/features/room/RoomShell.tsx` (panel state)
- Modify: `src/features/room/icons.tsx` (`ChatIcon`)
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: the Task 1 model, `useRoomContext`, `createBrowserSupabase`, `AccentBar`, and `Member`.
- Produces:
  - `useChat(lessonId: string, member: Member)`, which returns `{ messages: ChatMessage[]; send(raw: string): Promise<'chat.empty' | 'chat.tooLong' | null>; unread: number; markRead(): void }`.
    - **On mount:** loads history with `from('chat').select(...).eq('lesson_id', lessonId).order('created_at')`, mapped to `ChatMessage` with status `saved`.
    - **Receiving:** registers `room.registerTextStreamHandler(CHAT_TOPIC, …)`, then decodes and merges each incoming message. It unregisters on unmount.
    - **On `RoomEvent.Reconnected`:** reloads the history and merges it.
    - **`send`:**
      - runs `prepareMessage`;
      - builds the message with `id = crypto.randomUUID()`, `createdAt = new Date().toISOString()`, `authorName = member.display_name` and status `sending`;
      - shows it right away;
      - calls `room.localParticipant.sendText(encodeChat(m), { topic: CHAT_TOPIC })`, ignoring failures;
      - inserts the row;
      - sets status `saved` when the insert succeeds, or `unsaved` when it fails.
    - **`unread`:** counts messages from the other person that arrived after the last `markRead`.
  - `<ChatPanel open onClose messages send member />`, a right-side panel. It is `w-full sm:w-80`, uses `.card`, and goes full height inside the stage area. It contains:
    - a header with the title `chat.title` and a Close button (`common.close`);
    - a message list (`role="log"`, `aria-live="polite"`) that auto-scrolls to the bottom unless the user has scrolled up. Each message shows:
      - the author's name, or "You" for your own messages;
      - the time (`HH:mm`, viewer locale);
      - the body rendered from `linkify` segments as text nodes and `<a>` elements, never as HTML;
      - "Not saved" in `text-pen` when the status is `unsaved`;
    - an `AccentBar`;
    - a textarea (`.field`, 1–4 rows auto-grow, `maxLength 2000`, placeholder `chat.placeholder`). Enter sends, using `shouldSendOnKey` with `nativeEvent.isComposing`;
    - a Send button.
    - Errors (`chat.empty` / `chat.tooLong`) appear inline under the input.
  - **Control bar:** a Chat icon button after Share. Its label is `bar.chat` or `bar.closeChat`, and it carries `aria-pressed`. A small `bg-pen` dot shows when `unread > 0`.
  - **RoomShell:**
    - holds the `chatOpen` state;
    - renders `ChatPanel` absolutely positioned at the right of the stage container (above the rail, with `z-20`), so it works on every stage and in fullscreen;
    - opening the panel calls `markRead`;
    - the chat state is personal (not synced).

- [ ] **Step 1: i18n keys**

| Key | EN | FR |
|---|---|---|
| `chat.title` | Chat | Discussion |
| `chat.placeholder` | Write a message… | Écrire un message… |
| `chat.send` | Send | Envoyer |
| `chat.you` | You | Vous |
| `chat.unsaved` | Not saved | Non enregistré |
| `chat.empty` | Write something first. | Écrivez d’abord un message. |
| `chat.tooLong` | Messages can be up to 2000 characters. | Un message peut contenir jusqu’à 2000 caractères. |
| `chat.loadFailed` | Earlier messages could not be loaded. | Les messages précédents n’ont pas pu être chargés. |
| `chat.none` | No messages yet. | Aucun message pour l’instant. |
| `bar.chat` | Chat | Discussion |
| `bar.closeChat` | Close chat | Fermer la discussion |

- [ ] **Step 2: Implement `useChat`, `ChatPanel`, `ChatIcon` (speech bubble), the control-bar button and the RoomShell wiring**

Follow the interface above. Keep the logic in the Task 1 helpers. React 19 lint rules apply:
- no ref writes during render;
- use `useEffectEvent` for handlers that must not re-subscribe.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.

Manual check (deferred to the controller):
- Two people chat and see messages instantly.
- A reload keeps the history.
- `<b>x</b>` shows as literal text.
- A link opens in a new tab.
- The unread dot appears and then clears when the panel opens.
- Accents type into the box.

- [ ] **Step 4: Commit:** `feat(chat): lesson chat panel with live delivery, history and unread dot`
