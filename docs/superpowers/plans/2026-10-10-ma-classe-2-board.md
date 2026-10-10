# Ma Classe — Plan 2: Shared Board and PDF Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared whiteboard (stage layout C). Both members draw and type on it live. PDFs and images become board pages. The board is saved per lesson. Accent bar, page jump, follow-teacher and laser pointer are included.

**Architecture:**
- The board is an Excalidraw 0.18.1 editor in its own stage module.
- It stays mounted and is only hidden while another stage is shown, so it never misses an update.
- Changes travel over the existing LiveKit room on two topics:
  - small changes go as reliable data packets on `ma-classe-board`;
  - full scenes go as LiveKit text streams on `ma-classe-board-scene`.
- Element merging uses Excalidraw's `reconcileElements`. A pure "known versions" map stops echo loops.
- The scene is saved to Supabase `board_saves` (3 s debounce, with retry and a local backup).
- Board images (PDF pages as WebP, inserted pictures) go to the private Supabase Storage bucket `lesson-files`. Each one gets a `files` row.
- All non-trivial logic lives in pure modules with Vitest tests. Components only wire them up.

**Tech Stack:**
- Next.js 16.4 App Router, React 19, TypeScript
- `@excalidraw/excalidraw` 0.18.1
- `pdfjs-dist` 6.3.289
- `livekit-client` 2.22.4, `@livekit/components-react` 2.9.24
- `@supabase/supabase-js` 2.117.3
- Vitest 5

**Spec:** `docs/superpowers/specs/2026-10-10-ma-classe-design.md`. Sections: §5 layout C, §6 board features, §7 documents (upload from computer; Drive is Plan 3), §9 sync protocol, §10 `board_saves` / `files`, and the storage policy.

## Global Constraints

- Either member can draw, type, insert files and jump pages. Only the teacher's viewport is broadcast for follow mode.
- PDF import:
  - each page is rendered with pdf.js at about 150 DPI, converted to WebP (quality 0.82) and uploaded to Storage;
  - each page becomes an image element inside a frame named `Page n`, with the frames stacked vertically;
  - at most 50 pages and 30 MB per file. Larger files are rejected before upload, with a message.
- Images: PNG, JPG, WebP. They are converted to WebP (longest side at most 2000 px), uploaded, and placed at the centre of the view.
- Supabase Storage holds only board images. Originals are not stored (Drive comes in Plan 3).
- Accent bar: é è ê ë à â ç ù û î ï ô œ, shown as capitals while Shift is held. A click inserts at the cursor of the focused text input (the board text editor, or any input) without moving focus.
- Follow teacher:
  - the student's view tracks the teacher's view centre and zoom;
  - any manual pan or zoom by the student pauses following and shows "Resume following".
- Data packets must stay under about 15 KB. Anything over 14 000 bytes of encoded JSON is sent with `localParticipant.sendText` instead.
- Board saving: debounced 3 s. A failed save is retried every 10 s and backed up to `localStorage`. A warning toast appears after 3 failures.
- UI copy goes through `src/lib/i18n/messages.ts`, in English and French (gender-neutral French). Controls use the shared `.btn`, `.field` and `.card` classes. Every clickable element gets a pointer cursor (already global).
- Exact package versions: `npm i --save-exact`.
- Test output must be pristine. `npm run lint` must report 0 errors.

**Inputs required from the user:** run the SQL migration `supabase/migrations/0003_board.sql` once, in the Supabase SQL Editor (Task 1).

## Review Focus

1. **Echo loops.** When A's change arrives at B and is applied, B's `onChange` must not send it back, or the two keep sending it to each other forever. Covered by `changedElements` / `markKnown` tests in Task 2.
2. **Big or wrong files.** A 120-page PDF, a 40 MB file or a `.docx` must produce a clear message, with nothing uploaded and no crash. Covered by `checkUpload` tests in Task 5.
3. **Student scrolls while following.** Following must pause and must not snap back on the next teacher update. Covered by `followReducer` tests in Task 6.
4. **Accent click with no text field focused.** Nothing should happen, with no error. With text selected, the selection is replaced. Covered by `insertAtCursor` tests in Task 6.
5. **Supabase down while drawing.** Saves are retried and the work is backed up locally, never lost silently. Covered by `createSaveQueue` tests in Task 3.

---

### Task 1: Dependencies, database and storage

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `supabase/migrations/0003_board.sql`
- Modify: `next.config.ts`

**Interfaces:**
- Produces:
  - Tables:
    - `public.board_saves(lesson_id uuid pk, scene jsonb, updated_at timestamptz, updated_by text)`
    - `public.files(id uuid pk, lesson_id uuid, storage_path text unique, kind text in ('page','image'), mime text, size_bytes bigint, width int, height int, name text, created_at timestamptz)`
  - A private Storage bucket `lesson-files`, readable and writable by members only.

- [ ] **Step 1: Install exact versions**

```bash
npm i --save-exact @excalidraw/excalidraw@0.18.1 pdfjs-dist@6.3.289
```

- [ ] **Step 2: Write the migration**

`supabase/migrations/0003_board.sql`:
```sql
-- Board scene per lesson and the images placed on the board.
create table public.board_saves (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  scene jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('page', 'image')),
  mime text not null,
  size_bytes bigint not null,
  width int not null,
  height int not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index files_lesson on public.files (lesson_id);

alter table public.board_saves enable row level security;
alter table public.files enable row level security;

create policy board_saves_read on public.board_saves for select to authenticated using (public.is_member());
create policy board_saves_insert on public.board_saves for insert to authenticated with check (public.is_member());
create policy board_saves_update on public.board_saves for update to authenticated
  using (public.is_member()) with check (public.is_member());

create policy files_read on public.files for select to authenticated using (public.is_member());
create policy files_insert on public.files for insert to authenticated with check (public.is_member());

-- Private bucket for board images (PDF pages as WebP, inserted pictures).
insert into storage.buckets (id, name, public)
values ('lesson-files', 'lesson-files', false)
on conflict (id) do nothing;

create policy lesson_files_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files' and public.is_member());
create policy lesson_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-files' and public.is_member());
```

- [ ] **Step 3 (USER ACTION, guided): Run the SQL**

The user pastes the file into the Supabase SQL Editor and clicks **Run**. Then verify:

```sql
select count(*) from public.board_saves;
select id, public from storage.buckets where id = 'lesson-files';
```
Expected: `0`, then one row with `lesson-files | false`.

- [ ] **Step 4: Only if `npm run build` fails on Excalidraw's ESM**

In `next.config.ts`, add `transpilePackages: ['@excalidraw/excalidraw']` to `nextConfig`. Otherwise leave `next.config.ts` unchanged.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: everything passes, and the build succeeds.

```bash
git add package.json package-lock.json next.config.ts supabase/migrations/0003_board.sql
git commit -m "feat(board): dependencies, board_saves/files tables and lesson-files bucket"
```

---

### Task 2: Board sync protocol and echo-free change tracking

**Files:**
- Create: `src/features/board/protocol.ts`
- Test: `src/features/board/protocol.test.ts`
- Create: `src/features/board/versions.ts`
- Test: `src/features/board/versions.test.ts`

**Interfaces:**
- Produces:
  - `BOARD_TOPIC = 'ma-classe-board'`
  - `SCENE_TOPIC = 'ma-classe-board-scene'`
  - `PACKET_LIMIT = 14000`
  - `type BoardElement = { id: string; version: number; versionNonce: number; isDeleted?: boolean; [k: string]: unknown }`
  - `type BoardMessage`, one of:
    - `{ t: 'elements'; elements: BoardElement[] }`
    - `{ t: 'scene-req' }`
    - `{ t: 'file'; fileId: string; path: string; mime: string; width: number; height: number }`
    - `{ t: 'viewport'; cx: number; cy: number; zoom: number }`
    - `{ t: 'pointer'; x: number; y: number; tool: 'pointer' | 'laser'; button: 'up' | 'down' }`
  - `encodeBoard(msg: BoardMessage): string`, which adds `v: 1`
  - `decodeBoard(text: string): BoardMessage | null`
  - `fitsInPacket(json: string): boolean`
  - `type KnownVersions = Map<string, number>`
  - `changedElements(known: KnownVersions, elements: readonly BoardElement[]): BoardElement[]`
  - `markKnown(known: KnownVersions, elements: readonly BoardElement[]): void`

- [ ] **Step 1: Write the failing tests**

`src/features/board/protocol.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeBoard, encodeBoard, fitsInPacket, PACKET_LIMIT } from './protocol';

const el = { id: 'a', version: 2, versionNonce: 7, type: 'rectangle' };

describe('board protocol', () => {
  it('round-trips each message type', () => {
    const msgs = [
      { t: 'elements', elements: [el] },
      { t: 'scene-req' },
      { t: 'file', fileId: 'f1', path: 'l/f1.webp', mime: 'image/webp', width: 800, height: 600 },
      { t: 'viewport', cx: 10.5, cy: -4, zoom: 1.25 },
      { t: 'pointer', x: 1, y: 2, tool: 'laser', button: 'down' },
    ] as const;
    for (const m of msgs) expect(decodeBoard(encodeBoard(m))).toEqual(m);
  });

  it('ignores other versions, garbage and malformed fields without throwing', () => {
    expect(decodeBoard('{"v":2,"t":"scene-req"}')).toBeNull();
    expect(decodeBoard('not json')).toBeNull();
    expect(decodeBoard('null')).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'elements', elements: [{ id: 'a' }] }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'viewport', cx: 'x', cy: 0, zoom: 1 }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'viewport', cx: 0, cy: 0, zoom: 0 }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'pointer', x: 0, y: 0, tool: 'pen', button: 'up' }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'file', fileId: 'f', path: 'p', mime: 'text/html', width: 1, height: 1 }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'nope' }))).toBeNull();
  });

  it('decides packet vs stream by encoded size', () => {
    expect(fitsInPacket('x'.repeat(PACKET_LIMIT))).toBe(true);
    expect(fitsInPacket('x'.repeat(PACKET_LIMIT + 1))).toBe(false);
    expect(fitsInPacket('é'.repeat(PACKET_LIMIT / 2 + 1))).toBe(false); // counts UTF-8 bytes, not characters
  });
});
```

`src/features/board/versions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { changedElements, markKnown, type KnownVersions } from './versions';

const v = (id: string, version: number) => ({ id, version, versionNonce: 1 });

describe('changedElements / markKnown', () => {
  it('reports only elements whose version is new to us', () => {
    const known: KnownVersions = new Map([['a', 1]]);
    expect(changedElements(known, [v('a', 1), v('b', 1), v('a', 2)].slice(0, 2))).toEqual([v('b', 1)]);
    expect(changedElements(known, [v('a', 2)])).toEqual([v('a', 2)]);
  });

  it('does not echo a remote change back after it was applied', () => {
    const known: KnownVersions = new Map();
    const remote = [v('x', 5)];
    markKnown(known, remote); // applied from the peer
    expect(changedElements(known, remote)).toEqual([]); // onChange fires with the same elements
  });

  it('never lowers a known version', () => {
    const known: KnownVersions = new Map([['a', 4]]);
    markKnown(known, [v('a', 2)]);
    expect(known.get('a')).toBe(4);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/features/board`
Expected: FAIL, because the modules do not exist yet.

- [ ] **Step 3: Implement**

`src/features/board/protocol.ts`:
```ts
export const BOARD_TOPIC = 'ma-classe-board';
export const SCENE_TOPIC = 'ma-classe-board-scene';
/** Reliable LiveKit packets must stay under ~15 KB; above this we use a text stream. */
export const PACKET_LIMIT = 14000;

export type BoardElement = { id: string; version: number; versionNonce: number; isDeleted?: boolean; [k: string]: unknown };

export type BoardMessage =
  | { t: 'elements'; elements: BoardElement[] }
  | { t: 'scene-req' }
  | { t: 'file'; fileId: string; path: string; mime: string; width: number; height: number }
  | { t: 'viewport'; cx: number; cy: number; zoom: number }
  | { t: 'pointer'; x: number; y: number; tool: 'pointer' | 'laser'; button: 'up' | 'down' };

const IMAGE_MIMES = ['image/webp', 'image/png', 'image/jpeg'];

export function encodeBoard(msg: BoardMessage): string {
  return JSON.stringify({ v: 1, ...msg });
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function isElement(e: unknown): e is BoardElement {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.id === 'string' && Number.isInteger(o.version) && Number.isInteger(o.versionNonce);
}

export function decodeBoard(text: string): BoardMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== 1) return null;
  switch (m.t) {
    case 'elements':
      return Array.isArray(m.elements) && m.elements.every(isElement) ? { t: 'elements', elements: m.elements } : null;
    case 'scene-req':
      return { t: 'scene-req' };
    case 'file':
      return typeof m.fileId === 'string' &&
        typeof m.path === 'string' &&
        typeof m.mime === 'string' &&
        IMAGE_MIMES.includes(m.mime) &&
        finite(m.width) &&
        finite(m.height)
        ? { t: 'file', fileId: m.fileId, path: m.path, mime: m.mime, width: m.width, height: m.height }
        : null;
    case 'viewport':
      return finite(m.cx) && finite(m.cy) && finite(m.zoom) && m.zoom > 0
        ? { t: 'viewport', cx: m.cx, cy: m.cy, zoom: m.zoom }
        : null;
    case 'pointer':
      return finite(m.x) && finite(m.y) && (m.tool === 'pointer' || m.tool === 'laser') && (m.button === 'up' || m.button === 'down')
        ? { t: 'pointer', x: m.x, y: m.y, tool: m.tool, button: m.button }
        : null;
    default:
      return null;
  }
}

export function fitsInPacket(json: string): boolean {
  return new TextEncoder().encode(json).length <= PACKET_LIMIT;
}
```

`src/features/board/versions.ts`:
```ts
import type { BoardElement } from './protocol';

/** Highest version of each element that we have already sent or received. */
export type KnownVersions = Map<string, number>;

export function changedElements(known: KnownVersions, elements: readonly BoardElement[]): BoardElement[] {
  return elements.filter((e) => (known.get(e.id) ?? -1) < e.version);
}

export function markKnown(known: KnownVersions, elements: readonly BoardElement[]): void {
  for (const e of elements) {
    if ((known.get(e.id) ?? -1) < e.version) known.set(e.id, e.version);
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- src/features/board`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/board
git commit -m "feat(board): versioned board protocol and echo-free change tracking"
```

---

### Task 3: Saving the board

**Files:**
- Create: `src/features/board/saveQueue.ts`
- Test: `src/features/board/saveQueue.test.ts`
- Create: `src/features/board/persistence.ts`

**Interfaces:**
- Consumes: `createBrowserSupabase()` (from `src/lib/supabase/client.ts`) and `BoardElement`.
- Produces:
  - `createSaveQueue(opts: { save: (scene: unknown) => Promise<void>; backup: (scene: unknown) => void; onFailures: (count: number) => void; delayMs?: number; retryMs?: number })`, returning `{ push(scene: unknown): void; flush(): Promise<void>; dispose(): void }`
  - `loadBoard(lessonId: string): Promise<{ elements: BoardElement[]; files: StoredFile[] }>`
  - `saveBoard(lessonId: string, email: string, elements: readonly BoardElement[]): Promise<void>`
  - `type StoredFile = { id: string; storage_path: string; mime: string; width: number; height: number }`
  - `backupKey(lessonId: string): string`

- [ ] **Step 1: Write the failing test**

`src/features/board/saveQueue.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from './saveQueue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSaveQueue', () => {
  it('debounces: saves only the latest scene after the delay', async () => {
    const save = vi.fn(async () => {});
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 3000 });
    q.push({ n: 1 });
    q.push({ n: 2 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ n: 2 });
    q.dispose();
  });

  it('backs up and retries a failed save, warning after 3 failures', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline');
    });
    const backup = vi.fn();
    const onFailures = vi.fn();
    const q = createSaveQueue({ save, backup, onFailures, delayMs: 10, retryMs: 100 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(backup).toHaveBeenCalledWith({ n: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(3);
    expect(onFailures).toHaveBeenLastCalledWith(3);
    q.dispose();
  });

  it('stops retrying once a save succeeds', async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error('offline');
    });
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 10, retryMs: 100 });
    q.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(10);
    fail = false;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    q.dispose();
  });

  it('flush saves immediately (End lesson)', async () => {
    const save = vi.fn(async () => {});
    const q = createSaveQueue({ save, backup: vi.fn(), onFailures: vi.fn(), delayMs: 3000 });
    q.push({ n: 9 });
    await q.flush();
    expect(save).toHaveBeenCalledWith({ n: 9 });
    q.dispose();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/features/board/saveQueue.test.ts`
Expected: FAIL, because the module does not exist yet.

- [ ] **Step 3: Implement**

`src/features/board/saveQueue.ts`:
```ts
export function createSaveQueue(opts: {
  save: (scene: unknown) => Promise<void>;
  backup: (scene: unknown) => void;
  onFailures: (count: number) => void;
  delayMs?: number;
  retryMs?: number;
}) {
  const delayMs = opts.delayMs ?? 3000;
  const retryMs = opts.retryMs ?? 10000;
  let pending: unknown = undefined;
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  async function run(): Promise<void> {
    timer = undefined;
    if (!hasPending) return;
    const scene = pending;
    hasPending = false;
    try {
      await opts.save(scene);
      failures = 0;
    } catch {
      failures += 1;
      opts.backup(scene);
      opts.onFailures(failures);
      // Retry the newest scene we have; a newer push replaces it.
      if (!hasPending) {
        pending = scene;
        hasPending = true;
      }
      timer = setTimeout(() => void run(), retryMs);
    }
  }

  return {
    push(scene: unknown) {
      pending = scene;
      hasPending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), failures > 0 ? retryMs : delayMs);
    },
    async flush() {
      clearTimeout(timer);
      await run();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
```

`src/features/board/persistence.ts`:
```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- src/features/board/saveQueue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/board
git commit -m "feat(board): debounced board saving with retry and local backup"
```

---

### Task 4: View maths: centre, follow and page layout

**Files:**
- Create: `src/features/board/view.ts`
- Test: `src/features/board/view.test.ts`

**Interfaces:**
- Produces:
  - `type ViewState = { scrollX: number; scrollY: number; zoom: number; width: number; height: number }`
  - `viewCenter(v: ViewState): { cx: number; cy: number }`, the scene point at the screen centre
  - `scrollForCenter(c: { cx: number; cy: number }, zoom: number, size: { width: number; height: number }): { scrollX: number; scrollY: number }`
  - `type FollowState = { following: boolean; lastApplied: { scrollX: number; scrollY: number; zoom: number } | null }`
  - `followReducer(s: FollowState, a: { type: 'applied'; scrollX: number; scrollY: number; zoom: number } | { type: 'scrolled'; scrollX: number; scrollY: number; zoom: number } | { type: 'resume' }): FollowState`
  - `layoutPages(sizes: readonly { width: number; height: number }[], opts?: { x?: number; y?: number; width?: number; gap?: number }): { x: number; y: number; width: number; height: number }[]`

- [ ] **Step 1: Write the failing test**

`src/features/board/view.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { followReducer, layoutPages, scrollForCenter, viewCenter, type FollowState } from './view';

describe('viewCenter / scrollForCenter', () => {
  it('round-trips between screen sizes', () => {
    const teacher = { scrollX: -100, scrollY: 50, zoom: 2, width: 1200, height: 800 };
    const c = viewCenter(teacher);
    expect(c).toEqual({ cx: 400, cy: 150 });
    const student = scrollForCenter(c, 2, { width: 800, height: 600 });
    expect(viewCenter({ ...student, zoom: 2, width: 800, height: 600 })).toEqual(c);
  });
});

describe('followReducer', () => {
  const start: FollowState = { following: true, lastApplied: null };

  it('stays following when the scroll is the one we applied', () => {
    let s = followReducer(start, { type: 'applied', scrollX: 10, scrollY: 20, zoom: 1 });
    s = followReducer(s, { type: 'scrolled', scrollX: 10.2, scrollY: 19.9, zoom: 1 });
    expect(s.following).toBe(true);
  });

  it('pauses when the student pans or zooms on their own', () => {
    let s = followReducer(start, { type: 'applied', scrollX: 10, scrollY: 20, zoom: 1 });
    s = followReducer(s, { type: 'scrolled', scrollX: 200, scrollY: 20, zoom: 1 });
    expect(s.following).toBe(false);
    s = followReducer(start, { type: 'applied', scrollX: 10, scrollY: 20, zoom: 1 });
    expect(followReducer(s, { type: 'scrolled', scrollX: 10, scrollY: 20, zoom: 1.5 }).following).toBe(false);
  });

  it('ignores teacher updates while paused, until Resume', () => {
    let s: FollowState = { following: false, lastApplied: null };
    s = followReducer(s, { type: 'applied', scrollX: 1, scrollY: 1, zoom: 1 });
    expect(s.following).toBe(false);
    expect(followReducer(s, { type: 'resume' }).following).toBe(true);
  });
});

describe('layoutPages', () => {
  it('scales pages to one width and stacks them with a gap', () => {
    const r = layoutPages([{ width: 600, height: 800 }, { width: 1200, height: 900 }], { x: 0, y: 0, width: 1000, gap: 80 });
    expect(r).toEqual([
      { x: 0, y: 0, width: 1000, height: 1333 },
      { x: 0, y: 1413, width: 1000, height: 750 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/features/board/view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/features/board/view.ts`:
```ts
export type ViewState = { scrollX: number; scrollY: number; zoom: number; width: number; height: number };

/** Excalidraw: screen = (scene + scroll) * zoom. */
export function viewCenter(v: ViewState): { cx: number; cy: number } {
  return { cx: v.width / 2 / v.zoom - v.scrollX, cy: v.height / 2 / v.zoom - v.scrollY };
}

export function scrollForCenter(
  c: { cx: number; cy: number },
  zoom: number,
  size: { width: number; height: number },
): { scrollX: number; scrollY: number } {
  return { scrollX: size.width / 2 / zoom - c.cx, scrollY: size.height / 2 / zoom - c.cy };
}

export type FollowState = { following: boolean; lastApplied: { scrollX: number; scrollY: number; zoom: number } | null };

const SCROLL_EPS = 1;
const ZOOM_EPS = 0.001;

export function followReducer(
  s: FollowState,
  a:
    | { type: 'applied'; scrollX: number; scrollY: number; zoom: number }
    | { type: 'scrolled'; scrollX: number; scrollY: number; zoom: number }
    | { type: 'resume' },
): FollowState {
  switch (a.type) {
    case 'resume':
      return { following: true, lastApplied: null };
    case 'applied':
      return s.following ? { following: true, lastApplied: { scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom } } : s;
    case 'scrolled': {
      if (!s.following || !s.lastApplied) return s;
      const l = s.lastApplied;
      const same =
        Math.abs(l.scrollX - a.scrollX) <= SCROLL_EPS &&
        Math.abs(l.scrollY - a.scrollY) <= SCROLL_EPS &&
        Math.abs(l.zoom - a.zoom) <= ZOOM_EPS;
      return same ? s : { following: false, lastApplied: null };
    }
  }
}

export function layoutPages(
  sizes: readonly { width: number; height: number }[],
  opts: { x?: number; y?: number; width?: number; gap?: number } = {},
): { x: number; y: number; width: number; height: number }[] {
  const x = opts.x ?? 0;
  const width = opts.width ?? 1000;
  const gap = opts.gap ?? 80;
  let y = opts.y ?? 0;
  return sizes.map((s) => {
    const height = Math.round((s.height * width) / s.width);
    const box = { x, y, width, height };
    y += height + gap;
    return box;
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- src/features/board/view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/board/view.ts src/features/board/view.test.ts
git commit -m "feat(board): view centre, follow-teacher reducer and page layout maths"
```

---

### Task 5: Turning PDFs and images into board pages

**Files:**
- Create: `src/features/board/upload.ts`
- Test: `src/features/board/upload.test.ts`
- Create: `src/features/board/render.ts`

**Interfaces:**
- Consumes: `createBrowserSupabase()`, `layoutPages`.
- Produces:
  - `MAX_BYTES = 30 * 1024 * 1024`
  - `MAX_PAGES = 50`
  - `type UploadCheck = { ok: true; kind: 'pdf' | 'image' } | { ok: false; reason: 'board.unsupported' | 'board.fileTooLarge' }`
  - `checkUpload(file: { name: string; type: string; size: number }): UploadCheck`
  - `pdfPagesError(pageCount: number): 'board.tooManyPages' | null`
  - `type RenderedPage = { blob: Blob; width: number; height: number }`
  - `renderPdf(file: File, onPage?: (n: number, total: number) => void): Promise<RenderedPage[]>`, which throws `PageLimitError` when there are more than `MAX_PAGES` pages
  - `class PageLimitError extends Error { pages: number }`
  - `imageToWebp(file: File): Promise<RenderedPage>`
  - `uploadBoardImage(lessonId: string, page: RenderedPage, kind: 'page' | 'image', name: string): Promise<{ fileId: string; path: string }>`
  - `downloadAsDataURL(path: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

`src/features/board/upload.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkUpload, MAX_BYTES, pdfPagesError } from './upload';

describe('checkUpload', () => {
  it('accepts PDFs and PNG/JPG/WebP images', () => {
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toEqual({ ok: true, kind: 'pdf' });
    expect(checkUpload({ name: 'b.png', type: 'image/png', size: 10 })).toEqual({ ok: true, kind: 'image' });
    expect(checkUpload({ name: 'c.jpg', type: 'image/jpeg', size: 10 })).toEqual({ ok: true, kind: 'image' });
    expect(checkUpload({ name: 'd.webp', type: 'image/webp', size: 10 })).toEqual({ ok: true, kind: 'image' });
  });

  it('trusts the .pdf extension when the browser gives no type', () => {
    expect(checkUpload({ name: 'Leçon.PDF', type: '', size: 10 })).toEqual({ ok: true, kind: 'pdf' });
  });

  it('rejects other files and anything over 30 MB, before uploading', () => {
    expect(checkUpload({ name: 'x.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10 })).toEqual({ ok: false, reason: 'board.unsupported' });
    expect(checkUpload({ name: 'big.pdf', type: 'application/pdf', size: MAX_BYTES + 1 })).toEqual({ ok: false, reason: 'board.fileTooLarge' });
  });
});

describe('pdfPagesError', () => {
  it('allows up to 50 pages', () => {
    expect(pdfPagesError(50)).toBeNull();
    expect(pdfPagesError(51)).toBe('board.tooManyPages');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/features/board/upload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the pure checks and storage helpers**

`src/features/board/upload.ts`:
```ts
import { createBrowserSupabase } from '@/lib/supabase/client';

export const MAX_BYTES = 30 * 1024 * 1024;
export const MAX_PAGES = 50;
const BUCKET = 'lesson-files';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export type UploadCheck = { ok: true; kind: 'pdf' | 'image' } | { ok: false; reason: 'board.unsupported' | 'board.fileTooLarge' };

export function checkUpload(file: { name: string; type: string; size: number }): UploadCheck {
  const isPdf = file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name));
  const isImage = IMAGE_TYPES.includes(file.type);
  if (!isPdf && !isImage) return { ok: false, reason: 'board.unsupported' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'board.fileTooLarge' };
  return { ok: true, kind: isPdf ? 'pdf' : 'image' };
}

export function pdfPagesError(pageCount: number): 'board.tooManyPages' | null {
  return pageCount > MAX_PAGES ? 'board.tooManyPages' : null;
}

export type RenderedPage = { blob: Blob; width: number; height: number };

export async function uploadBoardImage(
  lessonId: string,
  page: RenderedPage,
  kind: 'page' | 'image',
  name: string,
): Promise<{ fileId: string; path: string }> {
  const supabase = createBrowserSupabase();
  const fileId = crypto.randomUUID();
  const path = `${lessonId}/${fileId}.webp`;
  const up = await supabase.storage.from(BUCKET).upload(path, page.blob, { contentType: 'image/webp', upsert: false });
  if (up.error) throw new Error('Could not upload the image', { cause: up.error });
  const row = await supabase.from('files').insert({
    id: fileId,
    lesson_id: lessonId,
    storage_path: path,
    kind,
    mime: 'image/webp',
    size_bytes: page.blob.size,
    width: page.width,
    height: page.height,
    name,
  });
  if (row.error) throw new Error('Could not record the image', { cause: row.error });
  return { fileId, path };
}

export async function downloadAsDataURL(path: string): Promise<string> {
  const { data, error } = await createBrowserSupabase().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('Could not download the image', { cause: error });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(data);
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- src/features/board/upload.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the browser renderers (verified by typecheck and the manual check in Task 8)**

`src/features/board/render.ts`:
```ts
'use client';

import { MAX_PAGES, type RenderedPage } from './upload';

/** About 150 DPI: pdf.js units are 72 per inch. */
const PDF_SCALE = 150 / 72;
const WEBP_QUALITY = 0.82;
const MAX_IMAGE_SIDE = 2000;

export class PageLimitError extends Error {
  constructor(public pages: number) {
    super(`PDF has ${pages} pages`);
    this.name = 'PageLimitError';
  }
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the page'))), 'image/webp', WEBP_QUALITY),
  );
}

export async function renderPdf(file: File, onPage?: (n: number, total: number) => void): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    if (doc.numPages > MAX_PAGES) throw new PageLimitError(doc.numPages);
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: PDF_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      pages.push({ blob: await canvasToWebp(canvas), width: canvas.width, height: canvas.height });
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
    return pages;
  } finally {
    void doc.destroy();
  }
}

export async function imageToWebp(file: File): Promise<RenderedPage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { blob: await canvasToWebp(canvas), width: canvas.width, height: canvas.height };
}
```

Run: `npx tsc --noEmit`
Expected: no errors. If `page.render` rejects `{ canvas, viewport }`, check `node_modules/pdfjs-dist/types/src/display/api.d.ts` (`RenderParameters`) and make the smallest change that fits it.

- [ ] **Step 6: Commit**

```bash
git add src/features/board/upload.ts src/features/board/upload.test.ts src/features/board/render.ts
git commit -m "feat(board): upload checks, PDF/image to WebP rendering and storage helpers"
```

---

### Task 6: Accent bar and text insertion

**Files:**
- Create: `src/features/board/accents.ts`
- Test: `src/features/board/accents.test.ts`
- Create: `src/features/board/AccentBar.tsx`

**Interfaces:**
- Produces:
  - `ACCENTS = ['é','è','ê','ë','à','â','ç','ù','û','î','ï','ô','œ']`
  - `insertAtCursor(value: string, start: number | null, end: number | null, text: string): { value: string; caret: number }`
  - `isTextTarget(el: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean`
  - `<AccentBar />`, which inserts into the last focused text input or textarea and keeps focus there

- [ ] **Step 1: Write the failing test**

`src/features/board/accents.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ACCENTS, insertAtCursor, isTextTarget } from './accents';

describe('insertAtCursor', () => {
  it('inserts at the caret', () => {
    expect(insertAtCursor('ecole', 0, 0, 'é')).toEqual({ value: 'éecole', caret: 1 });
    expect(insertAtCursor('frre', 2, 2, 'è')).toEqual({ value: 'frère'.slice(0, 3) + 're', caret: 3 });
  });

  it('replaces a selection', () => {
    expect(insertAtCursor('garcon', 3, 4, 'ç')).toEqual({ value: 'garçon', caret: 4 });
  });

  it('appends when the caret is unknown', () => {
    expect(insertAtCursor('cafe', null, null, 'é')).toEqual({ value: 'cafeé', caret: 5 });
  });
});

describe('isTextTarget', () => {
  it('accepts textareas, text inputs and editable elements only', () => {
    expect(isTextTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextTarget(null)).toBe(false);
  });
});

it('has the 13 French accents from the spec', () => {
  expect(ACCENTS.join('')).toBe('éèêëàâçùûîïôœ');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/features/board/accents.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/features/board/accents.ts`:
```ts
export const ACCENTS = ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'ù', 'û', 'î', 'ï', 'ô', 'œ'] as const;

export function insertAtCursor(value: string, start: number | null, end: number | null, text: string) {
  const s = start ?? value.length;
  const e = end ?? s;
  return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
}

const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', ''];

export function isTextTarget(el: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.includes(el.type ?? '');
}
```

`src/features/board/AccentBar.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { ACCENTS, insertAtCursor, isTextTarget } from './accents';

/** Types into the last focused text field. The board's text editor is a textarea. */
export function AccentBar() {
  const t = useT();
  const target = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null>(null);
  const [upper, setUpper] = useState(false);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (isTextTarget(e.target as HTMLElement)) target.current = e.target as HTMLElement;
    };
    const onKey = (e: KeyboardEvent) => setUpper(e.shiftKey);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  function insert(ch: string) {
    const el = target.current;
    if (!el || !el.isConnected) return;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const next = insertAtCursor(el.value, el.selectionStart, el.selectionEnd, ch);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      // React and Excalidraw track the native value setter, so set it through the prototype.
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next.value);
      el.setSelectionRange(next.caret, next.caret);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      document.execCommand('insertText', false, ch);
    }
  }

  return (
    <div role="toolbar" aria-label={t('board.accents')} className="card flex flex-wrap gap-1 p-1 shadow-md">
      {ACCENTS.map((a) => {
        const ch = upper ? a.toUpperCase() : a;
        return (
          <button
            key={a}
            type="button"
            title={ch}
            aria-label={ch}
            // Keep focus in the text field being edited.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(ch)}
            className="flex size-8 items-center justify-center rounded-md text-base font-medium hover:bg-surface-2"
          >
            {ch}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/features/board/accents.test.ts && npx tsc --noEmit`
Expected: PASS. The `isTextTarget` import was already used, so lint stays clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/board/accents.ts src/features/board/accents.test.ts src/features/board/AccentBar.tsx
git commit -m "feat(board): French accent bar that types into the focused field"
```

---

### Task 7: The Board stage module

**Files:**
- Create: `src/features/board/useBoardChannel.ts`
- Create: `src/features/stage/Board.tsx`
- Modify: `src/lib/i18n/messages.ts`, adding the keys below

**Interfaces:**
- Consumes:
  - from Tasks 2–6: `encodeBoard`, `decodeBoard`, `fitsInPacket`, `BOARD_TOPIC`, `SCENE_TOPIC`, `changedElements`, `markKnown`, `createSaveQueue`, `loadBoard`, `saveBoard`, `backupKey`, `viewCenter`, `scrollForCenter`, `followReducer`, `layoutPages`, `checkUpload`, `renderPdf`, `PageLimitError`, `imageToWebp`, `uploadBoardImage`, `downloadAsDataURL`, `AccentBar`;
  - `Member`, `useT`, `useLocale`.
- Produces:
  - `useBoardChannel(onMessage: (m: BoardMessage, from: string) => void): { send(m: BoardMessage, opts?: { to?: string[]; lossy?: boolean }): Promise<void> }`
  - `default export Board({ lessonId, member, visible, onError }: { lessonId: string; member: Member; visible: boolean; onError: (key: MessageKey) => void })`. The root element has `data-testid="board"`.

- [ ] **Step 1: Add the i18n keys**

In `src/lib/i18n/messages.ts`, add to `en`:
```ts
  'board.accents': 'French accents',
  'board.insert': 'Add a PDF or image',
  'board.adding': 'Adding page {n} of {total}…',
  'board.addingImage': 'Adding image…',
  'board.unsupported': 'Only PDF, PNG, JPG and WebP files can be added.',
  'board.fileTooLarge': 'This file is over 30 MB. Use a smaller file.',
  'board.tooManyPages': 'This PDF has more than 50 pages. Split it and add the parts.',
  'board.uploadFailed': 'The file could not be added. Check your connection and try again.',
  'board.saveFailed': 'The board is not saved yet. Retrying…',
  'board.loadFailed': 'The saved board could not be loaded. New drawings are still shared.',
  'board.pages': 'Pages',
  'board.page': 'Page {n}',
  'board.following': 'Following your teacher',
  'board.resume': 'Resume following',
  'bar.board': 'Board',
  'bar.closeBoard': 'Back to cameras',
```
Add to `fr`:
```ts
  'board.accents': 'Accents français',
  'board.insert': 'Ajouter un PDF ou une image',
  'board.adding': 'Ajout de la page {n} sur {total}…',
  'board.addingImage': 'Ajout de l’image…',
  'board.unsupported': 'Seuls les fichiers PDF, PNG, JPG et WebP peuvent être ajoutés.',
  'board.fileTooLarge': 'Ce fichier dépasse 30 Mo. Utilisez un fichier plus léger.',
  'board.tooManyPages': 'Ce PDF dépasse 50 pages. Découpez-le et ajoutez les parties.',
  'board.uploadFailed': 'Le fichier n’a pas pu être ajouté. Vérifiez votre connexion et réessayez.',
  'board.saveFailed': 'Le tableau n’est pas encore enregistré. Nouvel essai…',
  'board.loadFailed': 'Le tableau enregistré n’a pas pu être chargé. Les nouveaux dessins restent partagés.',
  'board.pages': 'Pages',
  'board.page': 'Page {n}',
  'board.following': 'Vous suivez votre prof',
  'board.resume': 'Reprendre le suivi',
  'bar.board': 'Tableau',
  'bar.closeBoard': 'Retour aux caméras',
```

- [ ] **Step 2: Add the channel hook**

`src/features/board/useBoardChannel.ts`:
```ts
'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { BOARD_TOPIC, decodeBoard, encodeBoard, fitsInPacket, SCENE_TOPIC, type BoardMessage } from './protocol';

export function useBoardChannel(onMessage: (m: BoardMessage, from: string) => void) {
  const room = useRoomContext();
  const handle = useEffectEvent(onMessage);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== BOARD_TOPIC || !participant) return;
      const msg = decodeBoard(new TextDecoder().decode(payload));
      if (msg) handle(msg, participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    room.registerTextStreamHandler(SCENE_TOPIC, async (reader, info) => {
      const msg = decodeBoard(await reader.readAll());
      if (msg) handle(msg, info.identity);
    });
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.unregisterTextStreamHandler(SCENE_TOPIC);
    };
  }, [room]);

  const send = useCallback(
    async (m: BoardMessage, opts?: { to?: string[]; lossy?: boolean }) => {
      const json = encodeBoard(m);
      if (fitsInPacket(json)) {
        await room.localParticipant.publishData(new TextEncoder().encode(json), {
          reliable: !opts?.lossy,
          topic: BOARD_TOPIC,
          destinationIdentities: opts?.to,
        });
      } else {
        await room.localParticipant.sendText(json, { topic: SCENE_TOPIC, destinationIdentities: opts?.to });
      }
    },
    [room],
  );

  return { send };
}
```

If `useEffectEvent` is not exported by the installed React, use the ref pattern from `src/features/sync/useSync.ts` instead.

- [ ] **Step 3: Write the Board component**

`src/features/stage/Board.tsx`:
```tsx
'use client';

import '@excalidraw/excalidraw/index.css';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, reconcileElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, Collaborator, ExcalidrawImperativeAPI, NormalizedZoomValue, SocketId } from '@excalidraw/excalidraw/types';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { backupKey, loadBoard, saveBoard } from '@/features/board/persistence';
import type { BoardElement, BoardMessage } from '@/features/board/protocol';
import { imageToWebp, PageLimitError, renderPdf } from '@/features/board/render';
import { createSaveQueue } from '@/features/board/saveQueue';
import { checkUpload, downloadAsDataURL, uploadBoardImage, type RenderedPage } from '@/features/board/upload';
import { useBoardChannel } from '@/features/board/useBoardChannel';
import { changedElements, markKnown, type KnownVersions } from '@/features/board/versions';
import { followReducer, layoutPages, scrollForCenter, viewCenter } from '@/features/board/view';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Member } from '@/lib/lessons/types';

const SEND_EVERY_MS = 50;
const VIEWPORT_EVERY_MS = 100;
const POINTER_EVERY_MS = 50;

function useThemeName(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.dataset.theme;
      setTheme(attr === 'dark' || (!attr && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    };
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mq.addEventListener('change', read);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', read);
    };
  }, []);
  return theme;
}

export default function Board({
  lessonId,
  member,
  visible,
  onError,
}: {
  lessonId: string;
  member: Member;
  visible: boolean;
  onError: (key: MessageKey) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const theme = useThemeName();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const known = useRef<KnownVersions>(new Map());
  const pendingSend = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastViewportSent = useRef(0);
  const lastPointerSent = useRef(0);
  const collaborators = useRef(new Map<SocketId, Collaborator>());
  const [follow, dispatchFollow] = useReducer(followReducer, { following: member.role === 'student', lastApplied: null });
  const [progress, setProgress] = useState<string | null>(null);
  const [frames, setFrames] = useState<ExcalidrawElement[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const queue = useRef(
    createSaveQueue({
      save: (scene) => saveBoard(lessonId, member.email, (scene as { elements: BoardElement[] }).elements),
      backup: (scene) => {
        try {
          localStorage.setItem(backupKey(lessonId), JSON.stringify(scene));
        } catch {
          // Storage full or blocked: the retry still runs.
        }
      },
      onFailures: (n) => {
        if (n === 3) onError('board.saveFailed');
      },
    }),
  );
  useEffect(() => {
    const q = queue.current;
    return () => {
      void q.flush();
      q.dispose();
    };
  }, []);

  const addFileFromStorage = useCallback(
    async (fileId: string, path: string, mime: string) => {
      if (!api || api.getFiles()[fileId]) return;
      const dataURL = await downloadAsDataURL(path);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: mime as BinaryFileData['mimeType'], created: Date.now() }]);
    },
    [api],
  );

  const applyRemote = useCallback(
    (remote: BoardElement[]) => {
      if (!api) return;
      const merged = reconcileElements(
        api.getSceneElementsIncludingDeleted() as OrderedExcalidrawElement[],
        remote as unknown as RemoteExcalidrawElement[],
        api.getAppState(),
      );
      markKnown(known.current, remote);
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [api],
  );

  const { send } = useBoardChannel((msg, from) => {
    if (!api) return;
    switch (msg.t) {
      case 'elements':
        applyRemote(msg.elements);
        break;
      case 'scene-req':
        void send(
          { t: 'elements', elements: api.getSceneElementsIncludingDeleted() as unknown as BoardElement[] },
          { to: [from] },
        ).catch(() => {});
        break;
      case 'file':
        void addFileFromStorage(msg.fileId, msg.path, msg.mime).catch(() => {});
        break;
      case 'viewport': {
        if (member.role !== 'student' || !follow.following) break;
        const state = api.getAppState();
        const next = scrollForCenter({ cx: msg.cx, cy: msg.cy }, msg.zoom, { width: state.width, height: state.height });
        dispatchFollow({ type: 'applied', ...next, zoom: msg.zoom });
        api.updateScene({
          appState: { scrollX: next.scrollX, scrollY: next.scrollY, zoom: { value: msg.zoom as NormalizedZoomValue } },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        break;
      }
      case 'pointer': {
        collaborators.current.set(from as SocketId, {
          pointer: { x: msg.x, y: msg.y, tool: msg.tool, renderCursor: msg.tool !== 'laser' },
          button: msg.button,
          username: from,
        });
        api.updateScene({ collaborators: new Map(collaborators.current) });
        break;
      }
    }
  });

  // First load: the saved scene and its images, then ask the other person for anything newer.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadBoard(lessonId);
        if (cancelled) return;
        await Promise.all(saved.files.map((f) => addFileFromStorage(f.id, f.storage_path, f.mime).catch(() => {})));
        if (saved.elements.length > 0) applyRemote(saved.elements);
      } catch {
        onError('board.loadFailed');
      }
      void send({ t: 'scene-req' }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [api, lessonId, addFileFromStorage, applyRemote, send, onError]);

  // A hidden Excalidraw has zero size; re-measure when it becomes visible.
  useEffect(() => {
    if (visible) api?.refresh();
  }, [visible, api]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      const all = elements as unknown as BoardElement[];
      setFrames(elements.filter((e) => e.type === 'frame' && !e.isDeleted));
      clearTimeout(pendingSend.current);
      pendingSend.current = setTimeout(() => {
        const changed = changedElements(known.current, all);
        if (changed.length === 0) return;
        markKnown(known.current, changed);
        void send({ t: 'elements', elements: changed }).catch(() => {});
        queue.current.push({ elements: all });
      }, SEND_EVERY_MS);
    },
    [send],
  );

  const onScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      if (!api) return;
      if (member.role === 'student') {
        dispatchFollow({ type: 'scrolled', scrollX, scrollY, zoom: zoom.value });
        return;
      }
      const now = Date.now();
      if (now - lastViewportSent.current < VIEWPORT_EVERY_MS) return;
      lastViewportSent.current = now;
      const { width, height } = api.getAppState();
      const c = viewCenter({ scrollX, scrollY, zoom: zoom.value, width, height });
      void send({ t: 'viewport', cx: c.cx, cy: c.cy, zoom: zoom.value }, { lossy: true }).catch(() => {});
    },
    [api, member.role, send],
  );

  const onPointerUpdate = useCallback(
    (p: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
      const now = Date.now();
      if (now - lastPointerSent.current < POINTER_EVERY_MS) return;
      lastPointerSent.current = now;
      void send({ t: 'pointer', x: p.pointer.x, y: p.pointer.y, tool: p.pointer.tool, button: p.button }, { lossy: true }).catch(() => {});
    },
    [send],
  );

  async function placePages(pages: RenderedPage[], kind: 'page' | 'image', name: string) {
    if (!api) return;
    const state: AppState = api.getAppState();
    const existing = api.getSceneElements();
    const bottom = existing.reduce((m, e) => Math.max(m, e.y + e.height), 0);
    const center = viewCenter({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height });
    const boxes =
      kind === 'page'
        ? layoutPages(pages, { x: 0, y: existing.length ? bottom + 160 : 0 })
        : [{ x: center.cx - pages[0].width / 4, y: center.cy - pages[0].height / 4, width: pages[0].width / 2, height: pages[0].height / 2 }];
    const pageOffset = frames.length;
    for (let i = 0; i < pages.length; i += 1) {
      if (kind === 'page') setProgress(t('board.adding', { n: i + 1, total: pages.length }));
      const { fileId, path } = await uploadBoardImage(lessonId, pages[i], kind, name);
      const dataURL = await blobToDataURL(pages[i].blob);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: 'image/webp', created: Date.now() }]);
      void send({ t: 'file', fileId, path, mime: 'image/webp', width: pages[i].width, height: pages[i].height }).catch(() => {});
      const imageId = crypto.randomUUID();
      const box = boxes[i];
      const skeleton =
        kind === 'page'
          ? [
              { type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId, locked: true },
              { type: 'frame' as const, children: [imageId], name: t('board.page', { n: pageOffset + i + 1 }), x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 },
            ]
          : [{ type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId }];
      const created = convertToExcalidrawElements(skeleton);
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    }
    setProgress(null);
  }

  async function onFile(file: File) {
    const check = checkUpload(file);
    if (!check.ok) return onError(check.reason);
    try {
      if (check.kind === 'pdf') {
        setProgress(t('board.adding', { n: 1, total: 1 }));
        await placePages(await renderPdf(file), 'page', file.name);
      } else {
        setProgress(t('board.addingImage'));
        await placePages([await imageToWebp(file)], 'image', file.name);
      }
    } catch (err) {
      onError(err instanceof PageLimitError ? 'board.tooManyPages' : 'board.uploadFailed');
    } finally {
      setProgress(null);
    }
  }

  const sortedFrames = [...frames].sort((a, b) => a.y - b.y);

  return (
    <div data-testid="board" className="relative h-full w-full">
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        onScrollChange={onScrollChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating
        theme={theme}
        langCode={locale === 'fr' ? 'fr-FR' : 'en'}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, changeViewBackgroundColor: false },
        }}
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
        <div className="pointer-events-auto">
          <AccentBar />
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {progress && <span role="status" className="card px-3 py-1.5 text-sm">{progress}</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current?.click()} disabled={progress !== null}>
            {t('board.insert')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </div>
      </div>

      {(sortedFrames.length > 1 || (member.role === 'student' && !follow.following)) && (
        <div className="absolute right-3 top-16 z-10 flex flex-col items-end gap-2">
          {member.role === 'student' && !follow.following && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => dispatchFollow({ type: 'resume' })}>
              {t('board.resume')}
            </button>
          )}
          {sortedFrames.length > 1 && (
            <nav aria-label={t('board.pages')} className="card flex flex-wrap gap-1 p-1">
              {sortedFrames.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  title={t('board.page', { n: i + 1 })}
                  onClick={() => api?.scrollToContent(f, { fitToContent: true, animate: true })}
                  className="min-w-8 rounded-md px-2 py-1 text-sm font-medium tabular-nums hover:bg-surface-2"
                >
                  {i + 1}
                </button>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
```

- [ ] **Step 4: Typecheck, lint and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

Excalidraw's typings are strict. Fix any mismatch at the boundary with a narrow cast, as the code above already does for elements, `FileId`, `SocketId` and the zoom value. Never use `any`. List every cast you add in the report.

- [ ] **Step 5: Commit**

```bash
git add src/features/board/useBoardChannel.ts src/features/stage/Board.tsx src/lib/i18n/messages.ts
git commit -m "feat(board): Excalidraw board with live sync, saving, PDF/image insert, follow, laser and page jump"
```

---

### Task 8: Put the board on the stage

**Files:**
- Modify: `src/features/room/RoomShell.tsx`
- Modify: `src/features/room/ControlBar.tsx`
- Modify: `src/features/room/icons.tsx`

**Interfaces:**
- Consumes:
  - `Board` (default export), loaded with `next/dynamic` and `ssr: false`;
  - `changeStage`, `resolveVisibleStage`, `AVAILABLE`.
- Produces:
  - Board icon button in the control bar, between Camera and Share. Its label is `bar.board`, or `bar.closeBoard` when active, and it uses `aria-pressed`.
  - `AVAILABLE` includes `'board'`.
  - Board stays mounted for the whole room and is hidden with the `hidden` class when the stage is not `board`.

- [ ] **Step 1: Add the icon**

In `src/features/room/icons.tsx`, append:
```tsx
export const BoardIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M5 14.5l3-3 3 3" />
  </svg>
);
```

- [ ] **Step 2: Add the control bar button**

In `src/features/room/ControlBar.tsx`:
1. Add the props `boardActive: boolean` and `onToggleBoard: () => void` to the signature and its type.
2. Import `BoardIcon`.
3. Insert this right after the separator `<span className="mx-1 h-4 w-px bg-line" aria-hidden />`:

```tsx
      <IconButton label={boardActive ? t('bar.closeBoard') : t('bar.board')} active={boardActive} onClick={onToggleBoard}>
        <BoardIcon />
      </IconButton>
```

- [ ] **Step 3: Wire it in RoomShell**

In `src/features/room/RoomShell.tsx`:

1. Add the imports:
   ```tsx
   import dynamic from 'next/dynamic';
   ```
   and, after the other imports:
   ```tsx
   const Board = dynamic(() => import('@/features/stage/Board'), { ssr: false });
   ```

2. Change `AVAILABLE`:
   ```tsx
   const AVAILABLE: readonly Stage[] = ['cameras', 'board', 'screen'];
   ```

3. Add this callback next to `toggleShare`:
   ```tsx
   const toggleBoard = useCallback(() => {
     changeStage(stageRef.current.stage === 'board' ? 'cameras' : 'board');
   }, [changeStage]);
   ```

4. In `renderBar`, pass the new props:
   ```tsx
         boardActive={visible === 'board'}
         onToggleBoard={toggleBoard}
   ```

5. Replace the stage body. Keep the board always mounted, and show cameras or the screen only when they are the stage:
   ```tsx
           {visible === 'cameras' && <CameraTiles variant="stage" />}
           <main className={visible === 'cameras' ? 'hidden' : 'min-w-0 flex-1'}>
             <div className={visible === 'board' ? 'h-full' : 'hidden'}>
               <Board lessonId={lessonId} member={member} visible={visible === 'board'} onError={(k) => showToast(t(k))} />
             </div>
             {visible === 'screen' && <ScreenView onStop={() => void localParticipant.setScreenShareEnabled(false).catch(() => {})} />}
           </main>
           {visible !== 'cameras' &&
             (fsActive ? (
               <FloatingCams />
             ) : (
               <aside className="w-44 shrink-0 overflow-y-auto border-l border-line bg-surface">
                 <CameraTiles variant="rail" />
               </aside>
             ))}
   ```
   These lines replace the existing `{visible === 'cameras' ? (...) : (<>...</>)}` block. Keep the fullscreen button, the compact bar and the toast exactly as they are.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Manual two-person check (on production after deploy, or local with two Google accounts)**

1. One person clicks **Board**.
   Expected: both see the board, the toast "… opened the board", and cameras on the right.
2. Draw a shape and type a sentence.
   Expected: the other person sees it within about half a second.
3. Type "ecole", put the caret before "e", and click **é** on the accent bar.
   Expected: "école", and the cursor stays in the text box.
4. Add a 3-page PDF.
   Expected:
   - the progress message "Adding page n of 3…";
   - three framed pages appear for both people;
   - page buttons 1 2 3 jump to each page.
5. Teacher pans and zooms.
   Expected: the student's view follows. The student drags the board: **Resume following** appears, and clicking it snaps back.
6. Choose the laser tool and move it.
   Expected: the other person sees the laser trail.
7. Reload the student's tab.
   Expected: the board comes back with all pages and drawings.
8. Add a 40 MB file or a `.docx`.
   Expected: a clear message and nothing added.
9. Switch to Dark theme.
   Expected: the board follows the theme.

- [ ] **Step 6: Commit**

```bash
git add src/features/room src/features/stage
git commit -m "feat(room): board stage with control-bar toggle, kept mounted for live sync"
```

---

### Task 9: Documents library and "Add to board"

Added 2026-10-10 at the user's request: a place to see every uploaded document, and a way to re-use one on the current board without uploading it again.

**Files:**
- Create: `supabase/migrations/0004_documents.sql`
- Create: `src/features/documents/group.ts` and test `src/features/documents/group.test.ts`
- Modify:
  - `src/features/board/upload.ts`: `uploadBoardImage` gains a `doc` argument
  - `src/features/board/persistence.ts`: `loadBoard` loads files by the ids the scene uses; adds `loadDocumentFiles`
  - `src/features/stage/Board.tsx`: document id on upload, `placeExisting`, the Add menu, and the `?add=` param
- Create:
  - `src/features/documents/DocumentsBrowser.tsx`: grid, search and viewer; also works as a picker
  - `src/app/documents/page.tsx`
- Modify:
  - `src/app/page.tsx`: header link "Documents"
  - `src/lib/i18n/messages.ts`

**Interfaces (produces):**
- New columns:
  - `files.document_id uuid null`. A null value means the file is its own document.
  - `files.page_index int not null default 0`.
- Types:
  - `type FileRow = { id; lesson_id; storage_path; kind: 'page'|'image'; width; height; name; created_at; document_id: string|null; page_index }`
  - `type DocumentGroup = { id; name; lessonId; createdAt; kind: 'pdf'|'image'; pages: FileRow[] }`
- `groupDocuments(rows): DocumentGroup[]`: newest first, pages sorted by `page_index`.
- `filterDocuments(docs, query): DocumentGroup[]`: name match that ignores case and accents.
- `uploadBoardImage(lessonId, page, kind, name, doc?: { documentId; pageIndex })`
- `loadDocumentFiles(documentId): Promise<FileRow[]>`
- `<DocumentsBrowser docs thumbs lessonDates liveLessonId? onPick? />`
- Route `/documents`.
- The board reads `?add=<documentId>` once, after the first load.

- [ ] **Step 1: Migration (USER ACTION: the user runs it in the Supabase SQL Editor)**

`supabase/migrations/0004_documents.sql`:
```sql
-- Group the pages of one uploaded PDF into a single document.
alter table public.files add column if not exists document_id uuid;
alter table public.files add column if not exists page_index int not null default 0;
create index if not exists files_document on public.files (document_id);
```

- [ ] **Step 2: Failing tests** in `src/features/documents/group.test.ts`. Cover these cases:
  - **Pages stay together:** the pages of one PDF form a single document, in page order. Use `page_index` 1 and then 0, and expect ids `['a','b']` with kind `pdf`.
  - **No document id:** a row with a null `document_id` and kind `image` becomes its own document, with its own id as the document id and kind `image`.
  - **Order:** the newest document comes first.
  - **Search:** `filterDocuments` matches `'PASSE'` → "Passé composé.pdf" and `'marche'` → "Vocabulaire marché.pdf". A blank query returns everything.

Run `npm test -- src/features/documents`. Expected: FAIL.

- [ ] **Step 3: Implement** `src/features/documents/group.ts`:
```ts
export type FileRow = {
  id: string; lesson_id: string; storage_path: string; kind: 'page' | 'image';
  width: number; height: number; name: string; created_at: string;
  document_id: string | null; page_index: number;
};
export type DocumentGroup = { id: string; name: string; lessonId: string; createdAt: string; kind: 'pdf' | 'image'; pages: FileRow[] };

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
```
Run the tests again. Expected: PASS.

- [ ] **Step 4: Upload and load**

**`uploadBoardImage`** takes a last optional `doc?: { documentId: string; pageIndex: number }` and inserts `document_id: doc?.documentId ?? null` and `page_index: doc?.pageIndex ?? 0`.

**`loadBoard`** loads files by the `fileId`s referenced in the saved scene, instead of by `lesson_id`. This way, documents reused from older lessons come back after a reload too:
```ts
const save = await supabase.from('board_saves').select('scene').eq('lesson_id', lessonId).maybeSingle();
if (save.error) throw new Error('Could not load the board', { cause: save.error });
const elements = (save.data?.scene as { elements?: BoardElement[] } | undefined)?.elements ?? [];
const fileIds = [...new Set(elements.map((e) => e.fileId).filter((id): id is string => typeof id === 'string'))];
if (fileIds.length === 0) return { elements, files: [] };
const files = await supabase.from('files').select('id, storage_path, mime, width, height').in('id', fileIds);
if (files.error) throw new Error('Could not load board files', { cause: files.error });
return { elements, files: (files.data ?? []) as StoredFile[] };
```

**Add `loadDocumentFiles(documentId)`.** It selects the `FileRow` columns where `document_id = documentId` or `id = documentId`, ordered by `page_index`, and throws on error.

- [ ] **Step 5: Board**

Read the current `Board.tsx` first. Then make these changes:

1. **Document id on upload.** In `placePages`, create one `documentId = crypto.randomUUID()` per call and pass `{ documentId, pageIndex: i }` to `uploadBoardImage`.
2. **Shared page helper.** Factor the "create image (+ frame) elements for one page box" code into a helper that both `placePages` and the new `placeExisting` use (DRY).
3. **`placeExisting(rows: FileRow[])`.** Same layout as `placePages`: PDFs become frames stacked below the existing content, and an image goes at the view centre. For each row, with no upload:
   - `await addFileFromStorage(row.id, row.storage_path, 'image/webp')`;
   - send `{ t: 'file', fileId: row.id, path: row.storage_path, mime: 'image/webp', width: row.width, height: row.height }`;
   - create the elements with `fileId: row.id`.
4. **Add menu.** Replace the single upload button with a small **Add** menu button (`board.add`). Its items:
   - `board.addUpload` opens the existing file input.
   - `board.addFromDocuments` opens a `<dialog>` with `showModal()`. It closes with Esc or a Close button (`common.close`). The dialog:
     - loads every `files` row (the `FileRow` columns);
     - groups the rows with `groupDocuments`;
     - gets signed thumbnails with `supabase.storage.from('lesson-files').createSignedUrls(firstPagePaths, 3600)`;
     - renders `<DocumentsBrowser … onPick={(d) => { close(); void placeExisting(d.pages); }} />`.
5. **`?add=`.** After the first-load effect has finished, if `new URLSearchParams(location.search).get('add')` is set:
   - run `loadDocumentFiles(id).then(placeExisting)` exactly once, guarded with a ref so StrictMode cannot run it twice;
   - then call `history.replaceState(null, '', location.pathname)`.
   
   On error, call `onError('board.uploadFailed')`.

- [ ] **Step 6: Documents browser and page**

**`DocumentsBrowser`** (client component). Props:
- `docs: DocumentGroup[]`
- `thumbs: Record<storage_path, signedUrl>`
- `lessonDates: Record<lessonId, string>`, already formatted
- `liveLessonId?: string`
- `onPick?: (d) => void`

It renders:
- A search box (`.field`, aria-label `documents.search`) that runs `filterDocuments`.
- A grid (`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4`) of `.card` buttons. Each card shows:
  - the first-page thumbnail (`aspect-[3/4] w-full object-cover object-top`, alt = name);
  - the name, truncated;
  - `documents.pages {n}`;
  - the lesson date.
- Card click:
  - with `onPick`, it calls `onPick`;
  - without `onPick`, it opens a viewer `<dialog>`.
- The viewer:
  - fetches signed URLs for all pages on open;
  - shows the pages large, with `loading="lazy"`;
  - has page buttons 1…n that scroll to that page, and ← / → keys;
  - has a Close button (`common.close`);
  - when `liveLessonId` is set, shows a primary link `documents.addToLesson` to `/lesson/${liveLessonId}?add=${doc.id}`.
- Empty state: `documents.empty`.

**`src/app/documents/page.tsx`** (server component):
1. `getMember`. If there is no member, redirect to `/login?denied=1`.
2. Load:
   - all `files` rows (the `FileRow` columns);
   - `lessons(id, started_at, status)`.
   
   Throw on any error so `error.tsx` handles it.
3. Group the files with `groupDocuments`.
4. Build signed URLs for the first pages with `createSignedUrls`. Skip this when the list is empty.
5. Build `lessonDates` with `formatLessonDate(started_at, locale, timeZone)`.
6. Render a header: the `Wordmark` linking to `/`, `ThemeSwitch` and `LanguageSwitch`. Then render `h1` `documents.title` and `<DocumentsBrowser … liveLessonId={live?.id} />`.

**Home** (`src/app/page.tsx`): add `<Link href="/documents" className="btn btn-secondary btn-sm">{t('documents.title')}</Link>` to the header actions.

- [ ] **Step 7: i18n (EN / FR)**

| Key | EN | FR |
|---|---|---|
| `documents.title` | Documents | Documents |
| `documents.search` | Search documents | Rechercher un document |
| `documents.empty` | No documents yet. Add a PDF or an image on the board during a lesson. | Aucun document pour l’instant. Ajoutez un PDF ou une image au tableau pendant un cours. |
| `documents.pages` | {n} pages | {n} pages |
| `documents.addToLesson` | Add to today’s board | Ajouter au tableau du jour |
| `board.add` | Add | Ajouter |
| `board.addUpload` | Upload a PDF or image | Importer un PDF ou une image |
| `board.addFromDocuments` | From my documents | Depuis mes documents |
| `common.close` | Close | Fermer |

- [ ] **Step 8: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`. All must pass.

Then commit:
```bash
git add -A
git commit -m "feat(documents): documents library, viewer and re-use on the board"
```

---

## After Plan 2

Run one real lesson with the board and a PDF worksheet. Then write Plan 3 (Google Drive class folder, synced media player) from spec §7 and the storage policy.
