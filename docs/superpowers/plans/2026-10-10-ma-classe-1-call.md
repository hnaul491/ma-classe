# Ma Classe — Plan 1: Sign-in, Lessons and the Video Call

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a private app where the teacher and the student sign in with Google, the teacher starts a lesson, and both hold a reliable 1-on-1 video call with screen share, fullscreen, reconnect status, and a Plan B link.

**Architecture:** One Next.js 16 app on Vercel. Supabase handles Google sign-in and stores members and lessons, with RLS limiting access to 2 emails. LiveKit Cloud carries video, audio, screen share, and a small JSON sync protocol over its data channel. The shared "stage" state uses a Lamport-style counter so both screens agree. Pure logic (rules, protocol, stage resolution, status) lives in small tested modules. React components are thin wrappers around that logic.

**Tech Stack:** Next.js 16.4.0 (App Router, TypeScript, Tailwind v4), React 19, `livekit-client` 2.22.4, `@livekit/components-react` 2.9.24, `livekit-server-sdk` 2.19.1, `@supabase/supabase-js` 2.117.3, `@supabase/ssr` 0.12.7, Vitest 5.0.3, Playwright 1.64.0, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-10-ma-classe-design.md`

**Roadmap.** Each later plan is written after the previous one ships:

| Plan | Scope (spec sections) |
|---|---|
| 1 (this) | Auth, members, lessons, token, pre-join, layouts A/B/D/F/G, control bar, stage sync, screen share, fullscreen, Plan B, keep-alive, deploy |
| 2 | Board: Excalidraw stage (C), board sync + merge + text streams, `board_saves` + IndexedDB retry, accent bar, follow, laser, PDF/image import, page jump, `files` + Storage |
| 3 | Drive Picker + export, synced media player (E), YouTube, audio strip, mini player |
| 4 | Chat, vocab, review page, vocab page, usage meter |

## Global Constraints

- Exactly 2 members, one per role (`teacher`, `student`). Emails are stored lowercase.
- Non-members see: "This classroom is private."
- Camera: 540p (`VideoPresets.h540`) with simulcast, adaptive stream, and dynacast.
- Screen share: 1080p at 15 fps (`ScreenSharePresets.h1080fps15`), `contentHint: 'detail'`, tab audio requested.
- Control bar order: Mic · Camera | (Board · Share · Media) | (Chat) ··· Plan B · End/Leave. In Plan 1 only Share is in the middle group; Board, Media, and Chat are added in Plans 2–4. The bar is icon-only, and every button has `title` and `aria-label`.
- The teacher's red button is "End lesson", with a 2-click confirm ("Click again to end"). The student's is "Leave".
- Free plans only. No payment card. No custom domain; use `<name>.vercel.app`.
- Secrets (`LIVEKIT_API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) are server-only. Only `NEXT_PUBLIC_*` values reach the browser.
- The password login exists only when `NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=1`. This is set only in local `.env.local` against the **dev** Supabase project. Production never sets it, and the production Supabase project has the Email provider disabled.
- Pin exact package versions (`--save-exact`).
- UI copy is plain English, as written in this plan.

**Inputs required from the user before Task 2:**
1. The teacher's Google email.
2. Confirmation that the student's Google email is `huynhluan491@gmail.com`.
3. The `vercel.app` name.
4. A Google Meet link for Plan B.

## Review Focus

1. **Join before the lesson starts, or after it ended.** The student must get a clear message, never a crash or an endless spinner. `authorizeJoin` tests are in Task 5, and the Ended view is in Task 4.
2. **Both press a stage button at the same moment.** Both screens must end on the same stage. A convergence test is in Task 6.
3. **One person starts sharing while the other is already sharing.** The older share stops and the stage stays on the screen; it must not flip back to cameras. `stageAfterLocalShareEnded` and `shouldStopLocalShare` tests are in Task 6.
4. **Pressing F while typing in a text field.** It must not toggle fullscreen. The `isTypingElement` test is in Task 9.
5. **An old tab after a deploy sends a message with a different protocol version, or garbage.** It must be ignored without throwing. `decode` tests are in Task 6.

---

### Task 1: Scaffold the app

**Files:**
- Create: whole Next.js scaffold in `C:\Users\huynh\ma-classe`
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `.env.example`

**Interfaces:**
- Produces: Tailwind color utilities `bg-paper bg-surface bg-surface-2 text-ink text-muted border-line text-pen bg-pen bg-pen-soft bg-hl text-hl-ink text-good bg-good-soft text-blue bg-blue bg-blue-soft`; `npm test` (Vitest); path alias `@/` → `src/`.

- [ ] **Step 1: Scaffold Next.js into the existing repo**

The repo already holds `docs/` and `.git`; create-next-app allows both.

Run (from `C:\Users\huynh\ma-classe`):
```bash
npx create-next-app@16.4.0 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```
Expected: "Success! Created ma-classe".

- [ ] **Step 2: Install runtime and test dependencies (exact versions)**

```bash
npm i --save-exact livekit-client@2.22.4 @livekit/components-react@2.9.24 livekit-server-sdk@2.19.1 @supabase/supabase-js@2.117.3 @supabase/ssr@0.12.7
npm i -D --save-exact vitest@5.0.3 @playwright/test@1.64.0
```

- [ ] **Step 3: Add the Vitest config**

`vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
```

In `package.json` `"scripts"`, add these and keep the existing ones:
```json
"test": "vitest run --passWithNoTests",
"test:watch": "vitest",
"e2e": "playwright test"
```

- [ ] **Step 4: Replace `src/app/globals.css` with the design tokens**

These tokens are the same as the approved proposal page.
```css
@import "tailwindcss";

:root {
  --paper: #f3f5f8;
  --surface: #ffffff;
  --surface-2: #e9edf3;
  --ink: #1a2230;
  --muted: #5a6477;
  --line: #d6dce6;
  --pen: #c42f27;
  --pen-soft: #fbe6e4;
  --hl: #ffe57a;
  --hl-ink: #1a2230;
  --good: #23784a;
  --good-soft: #e1f2e8;
  --blue: #2949c9;
  --blue-soft: #e4e9fb;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #11151c;
    --surface: #19202a;
    --surface-2: #222b37;
    --ink: #e6eaf1;
    --muted: #9ba5b6;
    --line: #2d3644;
    --pen: #ff6f62;
    --pen-soft: #3a1f1f;
    --hl: #6b5815;
    --hl-ink: #fff3c4;
    --good: #5fc78d;
    --good-soft: #17301f;
    --blue: #8ea7ff;
    --blue-soft: #1f2846;
    color-scheme: dark;
  }
}

@theme inline {
  --color-paper: var(--paper);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-pen: var(--pen);
  --color-pen-soft: var(--pen-soft);
  --color-hl: var(--hl);
  --color-hl-ink: var(--hl-ink);
  --color-good: var(--good);
  --color-good-soft: var(--good-soft);
  --color-blue: var(--blue);
  --color-blue-soft: var(--blue-soft);
}

body {
  background: var(--paper);
  color: var(--ink);
}
```

- [ ] **Step 5: Set the app title in `src/app/layout.tsx`**

Replace the `metadata` export:
```tsx
export const metadata: Metadata = {
  title: 'Ma Classe',
  description: 'Private French classroom',
};
```

- [ ] **Step 6: Add `.env.example`**

```bash
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# LiveKit Cloud (Settings → Keys)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
# Plan B
NEXT_PUBLIC_PLAN_B_URL=https://meet.google.com/xxx-xxxx-xxx
# Vercel Cron sends "Authorization: Bearer $CRON_SECRET"
CRON_SECRET=
# Local dev against the DEV Supabase project only
NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=0
E2E_TEACHER_EMAIL=
E2E_TEACHER_PASSWORD=
E2E_STUDENT_EMAIL=
E2E_STUDENT_PASSWORD=
```

- [ ] **Step 7: Verify build and test runner**

Run: `npm run build`. Expected: build succeeds.
Run: `npm test`. Expected: "No test files found", exit code 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind tokens and Vitest"
```

---

### Task 2: Accounts and database schema

**USER ACTION steps** need the user's own accounts. The executor guides the user through them and waits; it does not create accounts itself.

**Files:**
- Create: `supabase/migrations/0001_members_lessons.sql`
- Create: `supabase/seed/members.prod.sql`
- Create: `supabase/seed/members.dev.sql`
- Create: `.env.local` (not committed)

**Interfaces:**
- Produces:
  - Tables `public.members(email pk, role, display_name)` and `public.lessons(id, title, status, started_at, ended_at)`.
  - SQL functions `public.member_role() returns text` and `public.is_member() returns boolean`.
  - At most one `live` lesson.

- [ ] **Step 1 (USER ACTION): Create the Supabase projects**

1. Create 2 free projects at https://supabase.com/dashboard: `ma-classe` (production) and `ma-classe-dev`. Use a region near Paris (`eu-west-3`) or Frankfurt.
2. From each project's Settings → API, copy the URL, the anon key, and the service_role key.

- [ ] **Step 2 (USER ACTION): Create the LiveKit Cloud project**

1. Sign up at https://cloud.livekit.io and create project `ma-classe`.
2. In Settings → Keys, create a key. Copy the WebSocket URL, the API key, and the API secret.

- [ ] **Step 3 (USER ACTION): Set up Google sign-in for the production project**

1. Go to https://console.cloud.google.com and create project `ma-classe`. Do not enable billing.
2. In APIs & Services → OAuth consent screen:
   - User type: External; app name "Ma Classe".
   - Scopes: `openid`, `email`, `profile`.
   - Publishing status: **Testing**.
   - Test users: add both Google emails. Only these two can sign in.
3. In Credentials → Create credentials → OAuth client ID:
   - Type: Web application.
   - Authorized redirect URI: `https://<prod-ref>.supabase.co/auth/v1/callback`
   - Copy the client ID and the secret.
4. In Supabase `ma-classe` → Authentication → Providers:
   - Enable **Google** and paste the client ID and secret.
   - **Disable Email.**
5. In Supabase `ma-classe` → Authentication → URL Configuration:
   - Site URL: `https://<name>.vercel.app`
   - Redirect URLs: `https://<name>.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`

- [ ] **Step 4 (USER ACTION): Set up the dev project for local testing**

In `ma-classe-dev`:
1. Authentication → Providers: keep **Email** enabled and turn off "Confirm email".
2. Authentication → Users → Add user, twice:
   - `teacher@test.local` with a password
   - `student@test.local` with a password

- [ ] **Step 5: Write the migration**

`supabase/migrations/0001_members_lessons.sql`:
```sql
create extension if not exists pgcrypto;

create table public.members (
  email text primary key check (email = lower(email)),
  role text not null unique check (role in ('teacher', 'student')),
  display_name text not null
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null check (status in ('live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Only one lesson can be live at a time.
create unique index lessons_one_live on public.lessons (status) where status = 'live';

create or replace function public.member_role() returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.member_role() is not null
$$;

revoke all on function public.member_role() from public, anon;
revoke all on function public.is_member() from public, anon;
grant execute on function public.member_role() to authenticated;
grant execute on function public.is_member() to authenticated;

alter table public.members enable row level security;
alter table public.lessons enable row level security;

create policy members_read on public.members
  for select to authenticated using (public.is_member());

create policy lessons_read on public.lessons
  for select to authenticated using (public.is_member());

create policy lessons_insert on public.lessons
  for insert to authenticated with check (public.member_role() = 'teacher');

create policy lessons_update on public.lessons
  for update to authenticated
  using (public.member_role() = 'teacher')
  with check (public.member_role() = 'teacher');
```

- [ ] **Step 6: Write the seeds**

`supabase/seed/members.prod.sql`. Replace `teacher@example.com` with the teacher's email that the user gave, written in lowercase:
```sql
insert into public.members (email, role, display_name) values
  ('teacher@example.com', 'teacher', 'Teacher'),
  ('huynhluan491@gmail.com', 'student', 'Student');
```

`supabase/seed/members.dev.sql`:
```sql
insert into public.members (email, role, display_name) values
  ('teacher@test.local', 'teacher', 'Teacher'),
  ('student@test.local', 'student', 'Student');
```

- [ ] **Step 7 (USER ACTION, guided): Apply the SQL**

1. In each project's SQL Editor, run `0001_members_lessons.sql`.
2. Run `members.prod.sql` in `ma-classe` and `members.dev.sql` in `ma-classe-dev`.

Verify in each project:
```sql
select email, role from public.members order by role;
```
Expected: 2 rows, `student` then `teacher`.

Verify the single-live rule in `ma-classe-dev`. The 2nd insert must fail with `duplicate key value violates unique constraint "lessons_one_live"`:
```sql
insert into public.lessons (title, status) values ('t1', 'live');
insert into public.lessons (title, status) values ('t2', 'live');
delete from public.lessons;
```

- [ ] **Step 8: Create `.env.local` pointing at the DEV project**

Fill it from `.env.example` with the dev Supabase values and the LiveKit values. Also set:
- `NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=1`
- the E2E emails and passwords from Step 4
- a random `CRON_SECRET` (`node -e "console.log(crypto.randomUUID())"`)

Check that `.env.local` is ignored:
```bash
git check-ignore .env.local
```
Expected output: `.env.local`

- [ ] **Step 9: Commit**

```bash
git add supabase
git commit -m "feat(db): members and lessons schema with RLS"
```

---

### Task 3: Sign-in and member check

**Files:**
- Create: `src/lib/lessons/types.ts`
- Create: `src/lib/auth/members.ts`
- Test: `src/lib/auth/members.test.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/env.ts`
- Create: `src/lib/auth/session.ts`
- Create: `src/proxy.ts`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/GoogleButton.tsx`
- Create: `src/app/login/DevLogin.tsx`

**Interfaces:**
- Produces:
  - `type Role = 'teacher' | 'student'`
  - `interface Member { email: string; role: Role; display_name: string }`
  - `interface Lesson { id: string; title: string; status: 'live' | 'ended'; started_at: string; ended_at: string | null }`
  - `normalizeEmail(email: string): string`
  - `isRole(v: unknown): v is Role`
  - `createClient(): Promise<SupabaseClient>` (server)
  - `createBrowserSupabase(): SupabaseClient`
  - `adminClient(): SupabaseClient`
  - `serverEnv(): { livekitUrl; livekitKey; livekitSecret; serviceRoleKey; cronSecret }`
  - `getMember(): Promise<{ user: { email: string } | null; member: Member | null }>`

- [ ] **Step 1: Write the failing tests**

`src/lib/auth/members.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isRole, normalizeEmail } from './members';

describe('normalizeEmail', () => {
  it('lowercases and trims so allowlist matching ignores case', () => {
    expect(normalizeEmail('  Huynh@Gmail.COM ')).toBe('huynh@gmail.com');
  });
});

describe('isRole', () => {
  it('accepts only teacher and student', () => {
    expect(isRole('teacher')).toBe(true);
    expect(isRole('student')).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/auth/members.test.ts`
Expected: FAIL, "Failed to resolve import './members'".

- [ ] **Step 3: Implement the types and member helpers**

`src/lib/lessons/types.ts`:
```ts
export type Role = 'teacher' | 'student';

export interface Member {
  email: string;
  role: Role;
  display_name: string;
}

export interface Lesson {
  id: string;
  title: string;
  status: 'live' | 'ended';
  started_at: string;
  ended_at: string | null;
}
```

`src/lib/auth/members.ts`:
```ts
import type { Role } from '@/lib/lessons/types';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isRole(v: unknown): v is Role {
  return v === 'teacher' || v === 'student';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/auth/members.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the env and Supabase clients**

`src/lib/env.ts`:
```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function serverEnv() {
  return {
    livekitUrl: required('LIVEKIT_URL'),
    livekitKey: required('LIVEKIT_API_KEY'),
    livekitSecret: required('LIVEKIT_API_SECRET'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    cronSecret: required('CRON_SECRET'),
  };
}

export const PLAN_B_URL = process.env.NEXT_PUBLIC_PLAN_B_URL ?? 'https://meet.google.com';
```

`src/lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}
```

`src/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`src/lib/supabase/admin.ts`:
```ts
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serverEnv().serviceRoleKey, {
    auth: { persistSession: false },
  });
}
```

`src/lib/auth/session.ts`:
```ts
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isRole, normalizeEmail } from '@/lib/auth/members';
import type { Member } from '@/lib/lessons/types';

export const getMember = cache(
  async (): Promise<{ user: { email: string } | null; member: Member | null }> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { user: null, member: null };

    const { data } = await supabase
      .from('members')
      .select('email, role, display_name')
      .eq('email', normalizeEmail(user.email))
      .maybeSingle();

    const member =
      data && isRole(data.role)
        ? { email: data.email, role: data.role, display_name: data.display_name }
        : null;
    return { user: { email: user.email }, member };
  },
);
```

- [ ] **Step 6: Add the session-refresh proxy**

Next.js 16 renamed `middleware.ts` to `proxy.ts`, with the exported function named `proxy`. If `npm run build` warns that the proxy file is not recognized, rename the file to `src/middleware.ts` and the function to `middleware`.

`src/proxy.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth', '/api'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // API routes check auth themselves and answer with JSON, never a redirect.
  if (!user && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 7: Add the OAuth callback**

`src/app/auth/callback/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.redirect(new URL('/login?error=1', request.url));
}
```

- [ ] **Step 8: Add the login page**

`src/app/login/GoogleButton.tsx`:
```tsx
'use client';

import { useEffect } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

export function GoogleButton({ signOutFirst }: { signOutFirst: boolean }) {
  useEffect(() => {
    // A signed-in non-member is sent here with ?denied=1; drop their session.
    if (signOutFirst) void createBrowserSupabase().auth.signOut();
  }, [signOutFirst]);

  return (
    <button
      type="button"
      className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface"
      onClick={() =>
        createBrowserSupabase().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        })
      }
    >
      Sign in with Google
    </button>
  );
}
```

`src/app/login/DevLogin.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

export function DevLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { error } = await createBrowserSupabase().auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) return setError(error.message);
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-72 flex-col gap-2 rounded-lg border border-dashed border-line p-4">
      <p className="text-xs text-muted">Dev only: password sign-in</p>
      <label className="flex flex-col text-sm">
        Email
        <input id="dev-email" name="email" type="email" className="rounded border border-line bg-surface px-2 py-1" />
      </label>
      <label className="flex flex-col text-sm">
        Password
        <input id="dev-password" name="password" type="password" className="rounded border border-line bg-surface px-2 py-1" />
      </label>
      <button type="submit" className="rounded bg-surface-2 px-3 py-1.5 text-sm">
        Sign in with password
      </button>
      {error && <p className="text-sm text-pen">{error}</p>}
    </form>
  );
}
```

`src/app/login/page.tsx`:
```tsx
import { DevLogin } from './DevLogin';
import { GoogleButton } from './GoogleButton';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-3xl font-bold">Ma Classe</h1>
      {sp.denied && <p className="text-pen">This classroom is private.</p>}
      {sp.error && <p className="text-pen">Sign-in failed. Try again.</p>}
      <GoogleButton signOutFirst={Boolean(sp.denied)} />
      {process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN === '1' && <DevLogin />}
    </main>
  );
}
```

- [ ] **Step 9: Verify manually**

1. Run `npm run dev` and open http://localhost:3000.
   Expected: redirect to `/login`, with the dev form visible.
2. Sign in as `teacher@test.local`.
   Expected: you land on `/`. The page is still the default scaffold until Task 4.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(auth): Google sign-in, member lookup, session proxy"
```

---

### Task 4: Lessons — home page, start and end

**Files:**
- Create: `src/lib/lessons/rules.ts`
- Test: `src/lib/lessons/rules.test.ts`
- Create: `src/lib/livekit/server.ts`
- Test: `src/lib/livekit/server.test.ts`
- Create: `src/app/actions.ts`
- Create: `src/app/LivePoller.tsx`
- Modify: `src/app/page.tsx` (replace entirely)
- Create: `src/app/lesson/[id]/page.tsx`

**Interfaces:**
- Consumes: `getMember()`, `createClient()`, `Member`, `Lesson`, `serverEnv()`.
- Produces:
  - `canStartLesson(m: Member | null): boolean`
  - `canEndLesson(m: Member | null): boolean`
  - `authorizeJoin(input: { signedIn: boolean; member: Member | null; lesson: Pick<Lesson, 'status'> | null }): JoinCheck`
  - `type JoinCheck = { ok: true } | { ok: false; status: 401 | 403 | 404 | 409; reason: string }`
  - `httpUrl(wsUrl: string): string`
  - `roomService(): RoomServiceClient`
  - `listIdentities(room: string): Promise<string[]>`
  - `deleteRoom(room: string): Promise<void>`
  - Server actions `startLesson(): Promise<void>` and `endLesson(lessonId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`src/lib/lessons/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { authorizeJoin, canEndLesson, canStartLesson } from './rules';
import type { Member } from './types';

const teacher: Member = { email: 't@x.fr', role: 'teacher', display_name: 'Teacher' };
const student: Member = { email: 's@x.fr', role: 'student', display_name: 'Student' };

describe('canStartLesson / canEndLesson', () => {
  it('allows only the teacher', () => {
    expect(canStartLesson(teacher)).toBe(true);
    expect(canStartLesson(student)).toBe(false);
    expect(canStartLesson(null)).toBe(false);
    expect(canEndLesson(teacher)).toBe(true);
    expect(canEndLesson(student)).toBe(false);
  });
});

describe('authorizeJoin', () => {
  it('rejects a visitor who is not signed in', () => {
    expect(authorizeJoin({ signedIn: false, member: null, lesson: null })).toEqual({
      ok: false,
      status: 401,
      reason: 'Sign in first.',
    });
  });

  it('rejects a signed-in non-member', () => {
    expect(authorizeJoin({ signedIn: true, member: null, lesson: { status: 'live' } })).toEqual({
      ok: false,
      status: 403,
      reason: 'This classroom is private.',
    });
  });

  it('rejects a lesson that does not exist', () => {
    expect(authorizeJoin({ signedIn: true, member: student, lesson: null })).toEqual({
      ok: false,
      status: 404,
      reason: 'This lesson does not exist.',
    });
  });

  it('rejects joining a lesson that has ended', () => {
    expect(authorizeJoin({ signedIn: true, member: student, lesson: { status: 'ended' } })).toEqual({
      ok: false,
      status: 409,
      reason: 'This lesson has ended.',
    });
  });

  it('lets either member join a live lesson, including after a page reload', () => {
    expect(authorizeJoin({ signedIn: true, member: student, lesson: { status: 'live' } })).toEqual({ ok: true });
    expect(authorizeJoin({ signedIn: true, member: teacher, lesson: { status: 'live' } })).toEqual({ ok: true });
  });
});
```

`src/lib/livekit/server.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { httpUrl } from './server';

describe('httpUrl', () => {
  it('turns the LiveKit WebSocket URL into the HTTP API URL', () => {
    expect(httpUrl('wss://ma-classe.livekit.cloud')).toBe('https://ma-classe.livekit.cloud');
    expect(httpUrl('ws://localhost:7880')).toBe('http://localhost:7880');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/lessons src/lib/livekit`
Expected: FAIL, the imports do not resolve.

- [ ] **Step 3: Implement the rules and LiveKit server helpers**

`src/lib/lessons/rules.ts`:
```ts
import type { Lesson, Member } from './types';

export function canStartLesson(m: Member | null): boolean {
  return m?.role === 'teacher';
}

export function canEndLesson(m: Member | null): boolean {
  return m?.role === 'teacher';
}

export type JoinCheck =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404 | 409; reason: string };

export function authorizeJoin(input: {
  signedIn: boolean;
  member: Member | null;
  lesson: Pick<Lesson, 'status'> | null;
}): JoinCheck {
  if (!input.signedIn) return { ok: false, status: 401, reason: 'Sign in first.' };
  if (!input.member) return { ok: false, status: 403, reason: 'This classroom is private.' };
  if (!input.lesson) return { ok: false, status: 404, reason: 'This lesson does not exist.' };
  if (input.lesson.status !== 'live') return { ok: false, status: 409, reason: 'This lesson has ended.' };
  return { ok: true };
}
```

`src/lib/livekit/server.ts`:
```ts
import { RoomServiceClient } from 'livekit-server-sdk';
import { serverEnv } from '@/lib/env';

export function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export function roomService(): RoomServiceClient {
  const env = serverEnv();
  return new RoomServiceClient(httpUrl(env.livekitUrl), env.livekitKey, env.livekitSecret);
}

export async function listIdentities(room: string): Promise<string[]> {
  try {
    const participants = await roomService().listParticipants(room);
    return participants.map((p) => p.identity);
  } catch {
    // The room does not exist until someone joins it.
    return [];
  }
}

export async function deleteRoom(room: string): Promise<void> {
  try {
    await roomService().deleteRoom(room);
  } catch {
    // Already gone; nothing to close.
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all tests so far).

- [ ] **Step 5: Add the server actions**

`src/app/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMember } from '@/lib/auth/session';
import { canEndLesson, canStartLesson } from '@/lib/lessons/rules';
import { deleteRoom } from '@/lib/livekit/server';
import { createClient } from '@/lib/supabase/server';

function lessonTitle(now: Date): string {
  const day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  return `Lesson ${day}`;
}

export async function startLesson(): Promise<void> {
  const { member } = await getMember();
  if (!canStartLesson(member)) throw new Error('Only the teacher can start a lesson.');
  const supabase = await createClient();

  const { data: live } = await supabase.from('lessons').select('id').eq('status', 'live').maybeSingle();
  let lessonId = live?.id as string | undefined;

  if (!lessonId) {
    const { data, error } = await supabase
      .from('lessons')
      .insert({ title: lessonTitle(new Date()), status: 'live' })
      .select('id')
      .single();
    if (error?.code === '23505') {
      // Started from another tab a moment ago; use that lesson.
      const { data: again } = await supabase.from('lessons').select('id').eq('status', 'live').single();
      lessonId = again?.id;
    } else if (error) {
      throw new Error(error.message);
    } else {
      lessonId = data.id;
    }
  }
  redirect(`/lesson/${lessonId}`);
}

export async function endLesson(lessonId: string): Promise<void> {
  const { member } = await getMember();
  if (!canEndLesson(member)) throw new Error('Only the teacher can end a lesson.');
  const supabase = await createClient();
  const { error } = await supabase
    .from('lessons')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', lessonId)
    .eq('status', 'live');
  if (error) throw new Error(error.message);
  // Deleting the LiveKit room disconnects everyone with reason ROOM_DELETED.
  await deleteRoom(lessonId);
  revalidatePath('/');
}
```

- [ ] **Step 6: Add the home page**

`src/app/LivePoller.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function LivePoller({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
```

`src/app/page.tsx` (replace the scaffold):
```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMember } from '@/lib/auth/session';
import type { Lesson } from '@/lib/lessons/types';
import { createClient } from '@/lib/supabase/server';
import { startLesson } from './actions';
import { LivePoller } from './LivePoller';

function minutesBetween(a: string, b: string | null): number | null {
  if (!b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const sp = await searchParams;
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const { data } = await supabase
    .from('lessons')
    .select('id, title, status, started_at, ended_at')
    .order('started_at', { ascending: false })
    .limit(50);
  const lessons = (data ?? []) as Lesson[];
  const live = lessons.find((l) => l.status === 'live') ?? null;
  const past = lessons.filter((l) => l.status === 'ended');

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Ma Classe</h1>
        <span className="rounded bg-surface-2 px-2 py-1 text-xs uppercase tracking-wide text-muted">{member.role}</span>
      </header>

      {sp.ended && <p role="status" className="rounded-lg bg-good-soft px-4 py-3 text-good">The lesson has ended.</p>}

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        {live ? (
          <>
            <p className="font-semibold">Lesson in progress: {live.title}</p>
            <Link href={`/lesson/${live.id}`} className="self-start rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface">
              Join lesson
            </Link>
          </>
        ) : member.role === 'teacher' ? (
          <form action={startLesson}>
            <button type="submit" className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface">
              Start lesson
            </button>
          </form>
        ) : (
          <>
            <p className="text-muted">Waiting for your teacher to start the lesson. This page updates by itself.</p>
            <LivePoller />
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Past lessons</h2>
        {past.length === 0 && <p className="text-muted">No lessons yet.</p>}
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {past.map((l) => (
            <li key={l.id} className="flex justify-between gap-4 px-4 py-3">
              <span>{l.title}</span>
              <span className="text-sm tabular-nums text-muted">{minutesBetween(l.started_at, l.ended_at) ?? '–'} min</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Add the lesson page (the Ended view now; the room comes in Task 10)**

`src/app/lesson/[id]/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const { data: lesson } = await supabase.from('lessons').select('id, title, status').eq('id', id).maybeSingle();
  if (!lesson) notFound();

  if (lesson.status !== 'live') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
        <p className="text-lg">This lesson has ended.</p>
        <Link href="/" className="text-blue underline">
          Back to home
        </Link>
      </main>
    );
  }

  return <main className="p-6">Room for {lesson.title} (Task 10)</main>;
}
```

- [ ] **Step 8: Verify manually**

1. Run `npm run dev` and sign in as the teacher.
   Expected: "Start lesson" button.
2. Click "Start lesson".
   Expected: `/lesson/<uuid>` shows the placeholder.
3. Go back to `/`.
   Expected: "Lesson in progress" and "Join lesson".
4. In a private window, sign in as the student.
   Expected: "Join lesson" is visible.
5. In the dev Supabase SQL editor, end the lesson:
   ```sql
   update public.lessons set status = 'ended', ended_at = now() where status = 'live';
   ```
6. Reload `/lesson/<uuid>`.
   Expected: "This lesson has ended."

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(lessons): home page, start/end lesson, join rules"
```

---

### Task 5: Token and presence API, retry helper

**Files:**
- Create: `src/lib/livekit/token.ts`
- Test: `src/lib/livekit/token.test.ts`
- Create: `src/lib/retry.ts`
- Test: `src/lib/retry.test.ts`
- Create: `src/app/api/token/route.ts`
- Create: `src/app/api/presence/route.ts`

**Interfaces:**
- Consumes: `authorizeJoin`, `getMember`, `createClient`, `serverEnv`, `listIdentities`.
- Produces:
  - `mintToken(p: { apiKey: string; apiSecret: string; identity: string; name: string; room: string; ttlSeconds?: number }): Promise<string>`
  - `class FatalError extends Error`
  - `withRetry<T>(fn: () => Promise<T>, opts: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> }): Promise<T>`
  - `GET /api/token?lesson=<id>` → `200 { token: string; url: string }` or `4xx { error: string }`
  - `GET /api/presence?lesson=<id>` → `200 { teacher: boolean; student: boolean }`

- [ ] **Step 1: Write the failing tests**

`src/lib/livekit/token.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mintToken } from './token';

function payload(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

describe('mintToken', () => {
  it('grants join, publish, subscribe and data for exactly one room', async () => {
    const jwt = await mintToken({
      apiKey: 'key',
      apiSecret: 'secret-secret-secret-secret-secret',
      identity: 's@x.fr',
      name: 'Student',
      room: 'lesson-1',
    });
    const p = payload(jwt);
    expect(p.sub).toBe('s@x.fr');
    expect(p.name).toBe('Student');
    expect(p.video).toMatchObject({
      roomJoin: true,
      room: 'lesson-1',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
  });

  it('expires after 4 hours by default', async () => {
    const jwt = await mintToken({
      apiKey: 'key',
      apiSecret: 'secret-secret-secret-secret-secret',
      identity: 'a',
      name: 'A',
      room: 'r',
    });
    const p = payload(jwt);
    expect(p.exp - p.nbf).toBe(4 * 60 * 60);
  });
});
```

`src/lib/retry.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { FatalError, withRetry } from './retry';

const noSleep = vi.fn(async () => {});

describe('withRetry', () => {
  it('retries until success with growing delays', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('down');
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 500, sleep },
    );
    expect(result).toBe('ok');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it('does not retry a FatalError', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new FatalError('This lesson has ended.');
        },
        { attempts: 3, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('This lesson has ended.');
    expect(calls).toBe(1);
  });

  it('throws the last error after the final attempt', async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error('still down');
        },
        { attempts: 2, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('still down');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/livekit/token.test.ts src/lib/retry.test.ts`
Expected: FAIL, the imports do not resolve.

- [ ] **Step 3: Implement `mintToken` and `withRetry`**

`src/lib/livekit/token.ts`:
```ts
import { AccessToken } from 'livekit-server-sdk';

export async function mintToken(p: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  room: string;
  ttlSeconds?: number;
}): Promise<string> {
  const at = new AccessToken(p.apiKey, p.apiSecret, {
    identity: p.identity,
    name: p.name,
    ttl: p.ttlSeconds ?? 4 * 60 * 60,
  });
  at.addGrant({ roomJoin: true, room: p.room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}
```

`src/lib/retry.ts`:
```ts
/** An error that retrying cannot fix, such as "This lesson has ended." */
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof FatalError) throw err;
      lastError = err;
      if (attempt < opts.attempts) await sleep(opts.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. If the 4-hour test fails because the token has no `nbf` claim, change that assertion to `expect(p.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(4 * 60 * 60 - 5)`.

- [ ] **Step 5: Add the API routes**

`src/app/api/token/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getMember } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { authorizeJoin } from '@/lib/lessons/rules';
import { mintToken } from '@/lib/livekit/token';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const lessonId = request.nextUrl.searchParams.get('lesson');
  const { user, member } = await getMember();

  let lesson: { status: 'live' | 'ended' } | null = null;
  if (member && lessonId) {
    const supabase = await createClient();
    const { data } = await supabase.from('lessons').select('status').eq('id', lessonId).maybeSingle();
    lesson = data as typeof lesson;
  }

  const check = authorizeJoin({ signedIn: Boolean(user), member, lesson });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status });

  const env = serverEnv();
  const token = await mintToken({
    apiKey: env.livekitKey,
    apiSecret: env.livekitSecret,
    identity: member!.email,
    name: member!.display_name,
    room: lessonId!,
  });
  return NextResponse.json({ token, url: env.livekitUrl });
}
```

`src/app/api/presence/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getMember } from '@/lib/auth/session';
import { listIdentities } from '@/lib/livekit/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const lessonId = request.nextUrl.searchParams.get('lesson');
  const { member } = await getMember();
  if (!member || !lessonId) return NextResponse.json({ error: 'This classroom is private.' }, { status: 403 });

  const identities = await listIdentities(lessonId);
  const supabase = await createClient();
  const { data } = await supabase.from('members').select('email, role');
  const roleOf = new Map((data ?? []).map((m) => [m.email as string, m.role as string]));
  const roles = identities.map((id) => roleOf.get(id));
  return NextResponse.json({ teacher: roles.includes('teacher'), student: roles.includes('student') });
}
```

- [ ] **Step 6: Verify manually**

1. With the dev server running, signed in as the teacher with a live lesson, open `/api/token?lesson=<live id>`.
   Expected: JSON with `token` and `url`.
2. Open the same URL with an ended lesson's id.
   Expected: 409 `{"error":"This lesson has ended."}`.
3. Open `/api/presence?lesson=<live id>`.
   Expected: `{"teacher":false,"student":false}`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): LiveKit token and presence routes, retry helper"
```

---

### Task 6: Sync protocol and stage logic

**Files:**
- Create: `src/features/sync/protocol.ts`
- Test: `src/features/sync/protocol.test.ts`
- Create: `src/features/sync/useSync.ts`
- Create: `src/features/room/stage.ts`
- Test: `src/features/room/stage.test.ts`

**Interfaces:**
- Consumes: `Role`.
- Produces:
  - `type Stage = 'cameras' | 'board' | 'screen' | 'media'`
  - `STAGES: readonly Stage[]`
  - `type SyncMessage = { t: 'stage'; stage: Stage; lamport: number; by: Role }`
  - `PROTOCOL_VERSION = 1`
  - `SYNC_TOPIC = 'ma-classe'`
  - `encode(msg: SyncMessage): Uint8Array`
  - `decode(data: Uint8Array): SyncMessage | null`
  - `useSync(onMessage: (msg: SyncMessage, fromIdentity: string) => void): (msg: SyncMessage, opts?: { to?: string[]; reliable?: boolean }) => Promise<void>`
  - `interface StageState { stage: Stage; lamport: number; by: Role | null }`
  - `initialStage: StageState`
  - `localStageChange(s: StageState, stage: Stage, by: Role): StageState`
  - `applyRemoteStage(s: StageState, msg: { stage: Stage; lamport: number; by: Role }): StageState` (returns the same object when nothing changes)
  - `resolveVisibleStage(stage: Stage, ctx: { screenActive: boolean; available: readonly Stage[] }): Stage`
  - `shouldStopLocalShare(localSharing: boolean, remotePublishedScreen: boolean): boolean`
  - `stageAfterLocalShareEnded(current: Stage, remoteShareActive: boolean): Stage | null`

- [ ] **Step 1: Write the failing tests**

`src/features/sync/protocol.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decode, encode } from './protocol';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('protocol', () => {
  it('round-trips a stage message', () => {
    const msg = { t: 'stage', stage: 'screen', lamport: 4, by: 'teacher' } as const;
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('ignores a message from a newer or older protocol version (old tab after a deploy)', () => {
    expect(decode(bytes(JSON.stringify({ v: 2, t: 'stage', stage: 'screen', lamport: 1, by: 'teacher' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ t: 'stage', stage: 'screen', lamport: 1, by: 'teacher' })))).toBeNull();
  });

  it('ignores garbage and malformed fields without throwing', () => {
    expect(decode(bytes('not json'))).toBeNull();
    expect(decode(bytes('null'))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'kitchen', lamport: 1, by: 'teacher' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'board', lamport: 1.5, by: 'teacher' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'board', lamport: 1, by: 'admin' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'unknown' })))).toBeNull();
  });
});
```

`src/features/room/stage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  applyRemoteStage,
  initialStage,
  localStageChange,
  resolveVisibleStage,
  shouldStopLocalShare,
  stageAfterLocalShareEnded,
  type StageState,
} from './stage';

describe('stage changes', () => {
  it('a local change bumps the counter and records who changed it', () => {
    expect(localStageChange(initialStage, 'screen', 'student')).toEqual({ stage: 'screen', lamport: 1, by: 'student' });
  });

  it('accepts a remote change with a higher counter', () => {
    const s: StageState = { stage: 'cameras', lamport: 2, by: 'teacher' };
    expect(applyRemoteStage(s, { stage: 'screen', lamport: 3, by: 'student' })).toEqual({ stage: 'screen', lamport: 3, by: 'student' });
  });

  it('ignores an older remote change and returns the same object', () => {
    const s: StageState = { stage: 'screen', lamport: 5, by: 'student' };
    expect(applyRemoteStage(s, { stage: 'cameras', lamport: 4, by: 'teacher' })).toBe(s);
  });

  it('both press at the same moment: both screens end on the teacher’s choice', () => {
    const start: StageState = { stage: 'cameras', lamport: 1, by: 'teacher' };
    const teacherLocal = localStageChange(start, 'board', 'teacher'); // lamport 2
    const studentLocal = localStageChange(start, 'screen', 'student'); // lamport 2
    const teacherFinal = applyRemoteStage(teacherLocal, { stage: 'screen', lamport: 2, by: 'student' });
    const studentFinal = applyRemoteStage(studentLocal, { stage: 'board', lamport: 2, by: 'teacher' });
    expect(teacherFinal.stage).toBe('board');
    expect(studentFinal.stage).toBe('board');
  });

  it('a late joiner adopts the current stage', () => {
    expect(applyRemoteStage(initialStage, { stage: 'screen', lamport: 7, by: 'teacher' }).stage).toBe('screen');
  });
});

describe('resolveVisibleStage', () => {
  const available = ['cameras', 'screen'] as const;

  it('falls back to cameras when the stage module is not built yet', () => {
    expect(resolveVisibleStage('board', { screenActive: false, available })).toBe('cameras');
  });

  it('falls back to cameras when the stage is screen but nobody is sharing', () => {
    expect(resolveVisibleStage('screen', { screenActive: false, available })).toBe('cameras');
    expect(resolveVisibleStage('screen', { screenActive: true, available })).toBe('screen');
  });
});

describe('screen share hand-over', () => {
  it('stops my share when the other person starts sharing', () => {
    expect(shouldStopLocalShare(true, true)).toBe(true);
    expect(shouldStopLocalShare(false, true)).toBe(false);
    expect(shouldStopLocalShare(true, false)).toBe(false);
  });

  it('keeps the stage on screen when my share ended because the other person took over', () => {
    expect(stageAfterLocalShareEnded('screen', true)).toBeNull();
  });

  it('returns to cameras when I stop sharing and nobody else shares', () => {
    expect(stageAfterLocalShareEnded('screen', false)).toBe('cameras');
  });

  it('leaves another stage alone', () => {
    expect(stageAfterLocalShareEnded('board', false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/features`
Expected: FAIL, the imports do not resolve.

- [ ] **Step 3: Implement the protocol and stage logic**

`src/features/sync/protocol.ts`:
```ts
import type { Role } from '@/lib/lessons/types';

export type Stage = 'cameras' | 'board' | 'screen' | 'media';
export const STAGES: readonly Stage[] = ['cameras', 'board', 'screen', 'media'];

export type SyncMessage = { t: 'stage'; stage: Stage; lamport: number; by: Role };

export const PROTOCOL_VERSION = 1;
export const SYNC_TOPIC = 'ma-classe';

export function encode(msg: SyncMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }));
}

function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v);
}

export function decode(data: Uint8Array): SyncMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== PROTOCOL_VERSION) return null;
  if (m.t === 'stage') {
    if (!isStage(m.stage)) return null;
    if (!Number.isInteger(m.lamport) || (m.lamport as number) < 0) return null;
    if (m.by !== 'teacher' && m.by !== 'student') return null;
    return { t: 'stage', stage: m.stage, lamport: m.lamport as number, by: m.by };
  }
  return null;
}
```

`src/features/room/stage.ts`:
```ts
import type { Stage } from '@/features/sync/protocol';
import type { Role } from '@/lib/lessons/types';

export interface StageState {
  stage: Stage;
  lamport: number;
  by: Role | null;
}

export const initialStage: StageState = { stage: 'cameras', lamport: 0, by: null };

export function localStageChange(s: StageState, stage: Stage, by: Role): StageState {
  return { stage, lamport: s.lamport + 1, by };
}

/** Higher counter wins; on a tie the teacher wins, so both sides converge. */
export function applyRemoteStage(s: StageState, msg: { stage: Stage; lamport: number; by: Role }): StageState {
  if (msg.lamport > s.lamport) return { stage: msg.stage, lamport: msg.lamport, by: msg.by };
  if (msg.lamport === s.lamport && msg.by === 'teacher' && s.by !== 'teacher') {
    return { stage: msg.stage, lamport: msg.lamport, by: msg.by };
  }
  return s;
}

export function resolveVisibleStage(
  stage: Stage,
  ctx: { screenActive: boolean; available: readonly Stage[] },
): Stage {
  if (!ctx.available.includes(stage)) return 'cameras';
  if (stage === 'screen' && !ctx.screenActive) return 'cameras';
  return stage;
}

export function shouldStopLocalShare(localSharing: boolean, remotePublishedScreen: boolean): boolean {
  return localSharing && remotePublishedScreen;
}

export function stageAfterLocalShareEnded(current: Stage, remoteShareActive: boolean): Stage | null {
  if (current !== 'screen') return null;
  return remoteShareActive ? null : 'cameras';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Add the sync hook (thin; exercised by Task 10's manual check and Task 12's E2E test)**

`src/features/sync/useSync.ts`:
```ts
'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useRef } from 'react';
import { decode, encode, SYNC_TOPIC, type SyncMessage } from './protocol';

export function useSync(onMessage: (msg: SyncMessage, fromIdentity: string) => void) {
  const room = useRoomContext();
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== SYNC_TOPIC || !participant) return;
      const msg = decode(payload);
      if (msg) handlerRef.current(msg, participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  return useCallback(
    (msg: SyncMessage, opts?: { to?: string[]; reliable?: boolean }) =>
      room.localParticipant.publishData(encode(msg), {
        reliable: opts?.reliable ?? true,
        topic: SYNC_TOPIC,
        destinationIdentities: opts?.to,
      }),
    [room],
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sync): versioned data protocol and convergent stage logic"
```

---

### Task 7: Pre-join screen (layout A)

**Files:**
- Create: `src/features/prejoin/audio.ts`
- Test: `src/features/prejoin/audio.test.ts`
- Create: `src/features/prejoin/usePresence.ts`
- Create: `src/features/prejoin/PreJoin.tsx`

**Interfaces:**
- Consumes: `GET /api/presence`, `Role`, `PLAN_B_URL` (passed in as `planBUrl`).
- Produces:
  - `rmsLevel(samples: Uint8Array): number` (0..1)
  - `useMicLevel(track?: MediaStreamTrack): number`
  - `playTestSound(outputDeviceId?: string): void`
  - `usePresence(lessonId: string): { teacher: boolean; student: boolean }`
  - `interface JoinChoices { audioEnabled: boolean; videoEnabled: boolean; audioDeviceId?: string; videoDeviceId?: string; audioOutputId?: string }`
  - `<PreJoin lessonId role error planBUrl onJoin={(c: JoinChoices) => Promise<void>} />`

- [ ] **Step 1: Write the failing test**

`src/features/prejoin/audio.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { rmsLevel } from './audio';

describe('rmsLevel', () => {
  it('is 0 for silence (all samples at the 128 midpoint)', () => {
    expect(rmsLevel(new Uint8Array(256).fill(128))).toBe(0);
  });

  it('is close to 1 for a full-scale square wave', () => {
    const loud = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 0 : 255));
    expect(rmsLevel(loud)).toBeCloseTo(1, 1);
  });

  it('is 0 for an empty buffer', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/features/prejoin`
Expected: FAIL, the import does not resolve.

- [ ] **Step 3: Implement the audio helpers**

`src/features/prejoin/audio.ts`:
```ts
'use client';

import { useEffect, useState } from 'react';

/** Root-mean-square level of 8-bit time-domain samples (128 = silence), from 0 to 1. */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const v of samples) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

export function useMicLevel(track?: MediaStreamTrack): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      setLevel(rmsLevel(buf));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [track]);
  return level;
}

export function playTestSound(outputDeviceId?: string): void {
  const ctx = new AudioContext();
  // AudioContext.setSinkId exists in Chromium; elsewhere the default speaker plays.
  const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (outputDeviceId && sink.setSinkId) void sink.setSinkId(outputDeviceId).catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  gain.gain.value = 0.15;
  osc.connect(gain).connect(ctx.destination);
  osc.onended = () => void ctx.close();
  osc.start();
  osc.stop(ctx.currentTime + 0.6);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/features/prejoin`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the presence hook and the pre-join component**

`src/features/prejoin/usePresence.ts`:
```ts
'use client';

import { useEffect, useState } from 'react';

export function usePresence(lessonId: string) {
  const [presence, setPresence] = useState({ teacher: false, student: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/presence?lesson=${encodeURIComponent(lessonId)}`);
        if (res.ok && alive) setPresence(await res.json());
      } catch {
        // Network hiccup: keep the last known value and try again on the next tick.
      }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lessonId]);
  return presence;
}
```

`src/features/prejoin/PreJoin.tsx`:
```tsx
'use client';

import { useMediaDevices, usePreviewTracks } from '@livekit/components-react';
import { Track, VideoPresets, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '@/lib/lessons/types';
import { playTestSound, useMicLevel } from './audio';
import { usePresence } from './usePresence';

export interface JoinChoices {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputId?: string;
}

export function PreJoin({
  lessonId,
  role,
  error,
  planBUrl,
  onJoin,
}: {
  lessonId: string;
  role: Role;
  error: string | null;
  planBUrl: string;
  onJoin: (c: JoinChoices) => Promise<void>;
}) {
  const [videoDeviceId, setVideoDeviceId] = useState<string | undefined>();
  const [audioDeviceId, setAudioDeviceId] = useState<string | undefined>();
  const [audioOutputId, setAudioOutputId] = useState<string | undefined>();
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const options = useMemo(
    () => ({
      audio: audioDeviceId ? { deviceId: audioDeviceId } : true,
      video: { deviceId: videoDeviceId, resolution: VideoPresets.h540.resolution },
    }),
    [audioDeviceId, videoDeviceId],
  );
  const tracks = usePreviewTracks(options, (e) => setDeviceError(e.message));
  const videoTrack = tracks?.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
  const audioTrack = tracks?.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;

  const videoEl = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoEl.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  const level = useMicLevel(audioTrack?.mediaStreamTrack);
  const cams = useMediaDevices({ kind: 'videoinput' });
  const mics = useMediaDevices({ kind: 'audioinput' });
  const speakers = useMediaDevices({ kind: 'audiooutput' });
  const presence = usePresence(lessonId);
  const otherIn = role === 'student' ? presence.teacher : presence.student;
  const otherName = role === 'student' ? 'Teacher' : 'Your student';

  async function join() {
    setJoining(true);
    await onJoin({
      audioEnabled: Boolean(audioTrack),
      videoEnabled: Boolean(videoTrack),
      audioDeviceId,
      videoDeviceId,
      audioOutputId,
    });
    setJoining(false);
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-4xl items-center gap-6 px-4 py-8 md:grid-cols-[1.2fr_1fr]">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-surface-2">
        {videoTrack ? (
          <video ref={videoEl} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">Camera is off</div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Camera
          <select
            id="prejoin-camera"
            className="rounded border border-line bg-surface px-2 py-1.5"
            value={videoDeviceId ?? ''}
            onChange={(e) => setVideoDeviceId(e.target.value || undefined)}
          >
            <option value="">Default camera</option>
            {cams.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Camera'}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Microphone
          <select
            id="prejoin-mic"
            className="rounded border border-line bg-surface px-2 py-1.5"
            value={audioDeviceId ?? ''}
            onChange={(e) => setAudioDeviceId(e.target.value || undefined)}
          >
            <option value="">Default microphone</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3 text-sm">
          <span className="w-24 text-muted">Mic level</span>
          <span className="h-2 flex-1 overflow-hidden rounded bg-surface-2" aria-hidden>
            <span className="block h-full bg-good" style={{ width: `${Math.round(Math.min(1, level * 3) * 100)}%` }} />
          </span>
        </div>

        {speakers.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            Speaker
            <select
              id="prejoin-speaker"
              className="rounded border border-line bg-surface px-2 py-1.5"
              value={audioOutputId ?? ''}
              onChange={(e) => setAudioOutputId(e.target.value || undefined)}
            >
              <option value="">Default speaker</option>
              {speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Speaker'}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() => playTestSound(audioOutputId)}
          className="self-start rounded bg-surface-2 px-3 py-1.5 text-sm"
        >
          Play test sound
        </button>

        <p className={otherIn ? 'text-good' : 'text-muted'}>
          {otherIn ? `${otherName} is in the room` : `${otherName} hasn't joined yet`}
        </p>

        {deviceError && (
          <p className="text-sm text-pen">
            Camera or microphone problem: {deviceError}. Check browser permissions, then reload.
          </p>
        )}
        {error && (
          <p className="text-sm text-pen">
            {error}{' '}
            <a href={planBUrl} target="_blank" rel="noopener" className="underline">
              Open Plan B
            </a>
          </p>
        )}

        <button
          type="button"
          onClick={join}
          disabled={joining}
          className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface disabled:opacity-60"
        >
          {joining ? 'Joining…' : 'Join lesson'}
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `usePreviewTracks` rejects `video.deviceId: undefined`, build the options object without the key when it is undefined.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(prejoin): device preview, mic level, test sound, presence"
```

---

### Task 8: Room building blocks — icons, control bar, camera tiles

**Files:**
- Create: `src/features/room/icons.tsx`
- Create: `src/features/room/ControlBar.tsx`
- Create: `src/features/stage/CameraTiles.tsx`
- Create: `src/features/room/useToast.ts`

**Interfaces:**
- Consumes: `Role`.
- Produces:
  - Icons `MicIcon MicOffIcon CamIcon CamOffIcon ShareIcon PlanBIcon EndIcon FullscreenIcon ExitFullscreenIcon`, each `() => JSX.Element`.
  - `<ControlBar role screenSharing onToggleShare onEnd planBUrl compact? />`
  - `<CameraTiles variant="stage" | "rail" />`
  - `useToast(): { message: string | null; show: (m: string) => void }`

- [ ] **Step 1: Add the icons**

`src/features/room/icons.tsx`:
```tsx
const stroke = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const MicIcon = () => (
  <svg {...stroke}>
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
    <path d="M3 8a5 5 0 0 0 10 0M8 13v2" />
  </svg>
);

export const MicOffIcon = () => (
  <svg {...stroke}>
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
    <path d="M3 8a5 5 0 0 0 10 0M8 13v2M2 2l12 12" />
  </svg>
);

export const CamIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
    <path d="M10.5 7l4-2.5v7l-4-2.5" />
  </svg>
);

export const CamOffIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
    <path d="M10.5 7l4-2.5v7l-4-2.5M2 2l12 12" />
  </svg>
);

export const ShareIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M8 9V5M6 7l2-2 2 2M5.5 14.5h5" />
  </svg>
);

export const PlanBIcon = () => (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="2.5" />
    <path d="M3.8 3.8l2.4 2.4M12.2 3.8L9.8 6.2M3.8 12.2l2.4-2.4M12.2 12.2L9.8 9.8" />
  </svg>
);

export const EndIcon = () => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden>
    <path d="M1.8 9.6c3.4-3.2 9-3.2 12.4 0l-1.6 2-2.6-1.1V8.6a7.5 7.5 0 0 0-4 0v1.9l-2.6 1.1z" />
  </svg>
);

export const FullscreenIcon = () => (
  <svg {...stroke}>
    <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
  </svg>
);

export const ExitFullscreenIcon = () => (
  <svg {...stroke}>
    <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
  </svg>
);
```

- [ ] **Step 2: Add the toast hook**

`src/features/room/useToast.ts`:
```ts
'use client';

import { useCallback, useEffect, useState } from 'react';

export function useToast(durationMs = 3000) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), durationMs);
    return () => clearTimeout(id);
  }, [message, durationMs]);
  const show = useCallback((m: string) => setMessage(m), []);
  return { message, show };
}
```

- [ ] **Step 3: Add the control bar**

`src/features/room/ControlBar.tsx`:
```tsx
'use client';

import { useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useState } from 'react';
import type { Role } from '@/lib/lessons/types';
import { CamIcon, CamOffIcon, EndIcon, MicIcon, MicOffIcon, PlanBIcon, ShareIcon } from './icons';

const btn = 'flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-blue';

function IconButton({
  label,
  active = false,
  className = '',
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`${btn} ${active ? 'bg-blue text-surface' : 'bg-surface-2 text-ink hover:bg-line'} ${className}`}
    >
      {children}
    </button>
  );
}

export function ControlBar({
  role,
  screenSharing,
  onToggleShare,
  onEnd,
  planBUrl,
  compact = false,
}: {
  role: Role;
  screenSharing: boolean;
  onToggleShare: () => void;
  onEnd: () => void;
  planBUrl: string;
  compact?: boolean;
}) {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    if (!confirmEnd) return;
    const id = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(id);
  }, [confirmEnd]);

  const endLabel = role === 'teacher' ? (confirmEnd ? 'Click again to end' : 'End lesson') : 'Leave';
  const onEndClick = () => {
    if (role === 'teacher' && !confirmEnd) return setConfirmEnd(true);
    onEnd();
  };

  return (
    <div
      className={
        compact
          ? 'flex items-center gap-1 rounded-full border border-line bg-surface/95 px-2 py-1 shadow-lg'
          : 'flex items-center gap-1.5 border-t border-line bg-surface px-3 py-2'
      }
    >
      <IconButton label={mic.enabled ? 'Mute microphone' : 'Unmute microphone'} onClick={() => void mic.toggle()}>
        {mic.enabled ? <MicIcon /> : <MicOffIcon />}
      </IconButton>
      <IconButton label={cam.enabled ? 'Turn camera off' : 'Turn camera on'} onClick={() => void cam.toggle()}>
        {cam.enabled ? <CamIcon /> : <CamOffIcon />}
      </IconButton>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <IconButton label={screenSharing ? 'Stop sharing' : 'Share screen'} active={screenSharing} onClick={onToggleShare}>
        <ShareIcon />
      </IconButton>
      {!compact && <span className="flex-1" />}
      {!compact && (
        <a
          href={planBUrl}
          target="_blank"
          rel="noopener"
          title="Plan B: open Google Meet"
          aria-label="Plan B: open Google Meet"
          className={`${btn} bg-hl text-hl-ink`}
        >
          <PlanBIcon />
        </a>
      )}
      <button
        type="button"
        title={endLabel}
        aria-label={endLabel}
        onClick={onEndClick}
        className={`flex h-9 items-center justify-center gap-1.5 rounded-full bg-pen px-3 text-surface ${confirmEnd ? 'ring-2 ring-pen ring-offset-2 ring-offset-surface' : ''}`}
      >
        <EndIcon />
        {confirmEnd && <span className="text-xs font-semibold">Click again</span>}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add the camera tiles**

`src/features/stage/CameraTiles.tsx`:
```tsx
'use client';

import { isTrackReference, useTracks, VideoTrack, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track } from 'livekit-client';

function CameraTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const p = trackRef.participant;
  const name = p.name || p.identity;
  const label = p.isLocal ? 'You' : name;
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  return (
    <div data-testid="camera-tile" className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface-2">
      {showVideo ? (
        <VideoTrack trackRef={trackRef} className={`h-full w-full object-cover ${p.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-soft text-lg font-semibold text-blue">
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <span className="absolute bottom-1 left-2 rounded bg-black/55 px-1.5 text-xs text-white">{label}</span>
    </div>
  );
}

export function CameraTiles({ variant }: { variant: 'stage' | 'rail' }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  return (
    <div
      className={
        variant === 'stage'
          ? 'grid h-full w-full grid-cols-1 content-center gap-3 p-4 sm:grid-cols-2'
          : 'flex flex-col gap-2 p-2'
      }
    >
      {tracks.map((t) => (
        <CameraTile key={`${t.participant.identity}-${t.source}`} trackRef={t} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(room): icon control bar, camera tiles, toast"
```

---

### Task 9: Screen view, fullscreen, status bar

**Files:**
- Create: `src/features/room/keys.ts`
- Test: `src/features/room/keys.test.ts`
- Create: `src/features/room/connection.ts`
- Test: `src/features/room/connection.test.ts`
- Create: `src/features/room/useFullscreen.ts`
- Create: `src/features/room/useAutoHide.ts`
- Create: `src/features/room/FloatingCams.tsx`
- Create: `src/features/room/StatusBar.tsx`
- Create: `src/features/stage/ScreenView.tsx`

**Interfaces:**
- Consumes: `CameraTiles`.
- Produces:
  - `isTypingElement(el: { tagName?: string; isContentEditable?: boolean } | null): boolean`
  - `isUserCancel(err: unknown): boolean`
  - `type Banner = { kind: 'none' } | { kind: 'connecting' } | { kind: 'reconnecting'; suggestPlanB: boolean } | { kind: 'disconnected' }`
  - `bannerFor(state: string, reconnectingSince: number | null, now: number): Banner`
  - `useFullscreen<T extends HTMLElement>(): { ref: React.RefObject<T | null>; active: boolean; toggle: () => Promise<void> }`
  - `useAutoHide(enabled: boolean, ms?: number): { visible: boolean; poke: () => void }`
  - `<FloatingCams />`
  - `<StatusBar planBUrl />`
  - `<ScreenView onStop />`

- [ ] **Step 1: Write the failing tests**

`src/features/room/keys.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isTypingElement, isUserCancel } from './keys';

describe('isTypingElement', () => {
  it('treats inputs, textareas, selects and editable elements as typing targets (F must not toggle fullscreen)', () => {
    expect(isTypingElement({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingElement({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('lets F toggle fullscreen everywhere else', () => {
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTypingElement({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingElement(null)).toBe(false);
  });
});

describe('isUserCancel', () => {
  it('recognizes the user closing the screen picker', () => {
    expect(isUserCancel({ name: 'NotAllowedError' })).toBe(true);
    expect(isUserCancel({ name: 'AbortError' })).toBe(true);
    expect(isUserCancel(new Error('boom'))).toBe(false);
    expect(isUserCancel(null)).toBe(false);
  });
});
```

`src/features/room/connection.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bannerFor } from './connection';

describe('bannerFor', () => {
  it('shows nothing while connected', () => {
    expect(bannerFor('connected', null, 0)).toEqual({ kind: 'none' });
  });

  it('shows connecting on first connect', () => {
    expect(bannerFor('connecting', null, 0)).toEqual({ kind: 'connecting' });
  });

  it('shows reconnecting without Plan B for the first 30 seconds', () => {
    expect(bannerFor('reconnecting', 1_000, 30_999)).toEqual({ kind: 'reconnecting', suggestPlanB: false });
    expect(bannerFor('signalReconnecting', 1_000, 10_000)).toEqual({ kind: 'reconnecting', suggestPlanB: false });
  });

  it('suggests Plan B after 30 seconds of reconnecting', () => {
    expect(bannerFor('reconnecting', 1_000, 31_001)).toEqual({ kind: 'reconnecting', suggestPlanB: true });
  });

  it('shows disconnected', () => {
    expect(bannerFor('disconnected', null, 0)).toEqual({ kind: 'disconnected' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/features/room`
Expected: the new files FAIL with unresolved imports; `stage.test.ts` still passes.

- [ ] **Step 3: Implement `keys.ts` and `connection.ts`**

`src/features/room/keys.ts`:
```ts
export function isTypingElement(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export function isUserCancel(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotAllowedError' || name === 'AbortError';
}
```

`src/features/room/connection.ts`:
```ts
export type Banner =
  | { kind: 'none' }
  | { kind: 'connecting' }
  | { kind: 'reconnecting'; suggestPlanB: boolean }
  | { kind: 'disconnected' };

const PLAN_B_AFTER_MS = 30_000;

/** `state` is a livekit-client ConnectionState value. */
export function bannerFor(state: string, reconnectingSince: number | null, now: number): Banner {
  switch (state) {
    case 'connecting':
      return { kind: 'connecting' };
    case 'reconnecting':
    case 'signalReconnecting':
      return {
        kind: 'reconnecting',
        suggestPlanB: reconnectingSince !== null && now - reconnectingSince > PLAN_B_AFTER_MS,
      };
    case 'disconnected':
      return { kind: 'disconnected' };
    default:
      return { kind: 'none' };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Add the fullscreen and auto-hide hooks**

`src/features/room/useFullscreen.ts`:
```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTypingElement } from './keys';

export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ref.current?.requestFullscreen();
    } catch {
      // The browser refused fullscreen; the normal layout keeps working.
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingElement(e.target as HTMLElement | null)) return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { ref, active, toggle };
}
```

`src/features/room/useAutoHide.ts`:
```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoHide(enabled: boolean, ms = 3000) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poke = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), ms);
  }, [ms]);

  useEffect(() => {
    if (!enabled) {
      clearTimeout(timer.current);
      setVisible(true);
      return;
    }
    poke();
    return () => clearTimeout(timer.current);
  }, [enabled, poke]);

  return { visible: !enabled || visible, poke };
}
```

- [ ] **Step 6: Add the floating cameras, status bar and screen view**

`src/features/room/FloatingCams.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { CameraTiles } from '@/features/stage/CameraTiles';

export function FloatingCams() {
  const [hidden, setHidden] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed right-4 top-4 z-20 rounded-full bg-surface px-3 py-1 text-xs shadow"
      >
        Show cameras
      </button>
    );
  }

  return (
    <div
      className="fixed z-20 w-36 cursor-grab touch-none rounded-lg bg-surface/90 shadow-xl active:cursor-grabbing"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, top: 16 }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <CameraTiles variant="rail" />
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setHidden(true)}
        className="w-full pb-1 text-center text-xs text-muted"
      >
        Hide cameras
      </button>
    </div>
  );
}
```

`src/features/room/StatusBar.tsx`:
```tsx
'use client';

import { useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { useEffect, useState } from 'react';
import { bannerFor } from './connection';

export function StatusBar({ planBUrl }: { planBUrl: string }) {
  const state = useConnectionState();
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
    setSince((prev) => (reconnecting ? (prev ?? Date.now()) : null));
  }, [state]);

  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  const banner = bannerFor(state, since, now);
  if (banner.kind === 'none') return null;

  const text =
    banner.kind === 'connecting'
      ? 'Connecting…'
      : banner.kind === 'reconnecting'
        ? 'Reconnecting… your work is saved.'
        : 'Disconnected.';

  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-hl px-4 py-1.5 text-sm text-hl-ink">
      <span>{text}</span>
      {(banner.kind === 'disconnected' || (banner.kind === 'reconnecting' && banner.suggestPlanB)) && (
        <a href={planBUrl} target="_blank" rel="noopener" className="font-semibold underline">
          Open Plan B
        </a>
      )}
    </div>
  );
}
```

`src/features/stage/ScreenView.tsx`:
```tsx
'use client';

import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function ScreenView({ onStop }: { onStop: () => void }) {
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const ref = tracks[tracks.length - 1];
  if (!ref) return <div className="flex h-full items-center justify-center text-muted">No one is sharing.</div>;

  if (ref.participant.isLocal) {
    const settings = ref.publication.track?.mediaStreamTrack.getSettings() as
      | (MediaTrackSettings & { displaySurface?: string })
      | undefined;
    const wholeScreen = settings?.displaySurface === 'monitor';
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 bg-blue-soft px-4 py-2 text-sm text-blue">
          <span>You are sharing your {wholeScreen ? 'entire screen' : 'screen'}.</span>
          <button type="button" onClick={onStop} className="rounded bg-blue px-3 py-1 font-semibold text-surface">
            Stop sharing
          </button>
        </div>
        {wholeScreen ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted">
            <p>Your preview is hidden so you don’t see a mirror inside a mirror.</p>
            <p>Tip: turn off notifications so private messages don’t appear on the shared screen.</p>
          </div>
        ) : (
          <VideoTrack trackRef={ref} className="min-h-0 flex-1 bg-black object-contain" />
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full bg-[#14181f]">
      <VideoTrack trackRef={ref} className="h-full w-full object-contain" />
      <span className="absolute left-3 top-3 rounded bg-blue-soft px-2 py-0.5 text-xs text-blue">
        {ref.participant.name || ref.participant.identity} is sharing their screen
      </span>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(room): screen view, fullscreen, floating cams, connection banner"
```

---

### Task 10: Wire the room together

**Files:**
- Create: `src/features/room/RoomShell.tsx`
- Create: `src/features/room/roomOptions.ts`
- Create: `src/app/lesson/[id]/LessonClient.tsx`
- Modify: `src/app/lesson/[id]/page.tsx` (replace the placeholder `return` for live lessons)

**Interfaces:**
- Consumes everything from Tasks 4–9:
  - `useSync`
  - `initialStage`, `localStageChange`, `applyRemoteStage`, `resolveVisibleStage`, `shouldStopLocalShare`, `stageAfterLocalShareEnded`
  - `ControlBar`, `CameraTiles`, `ScreenView`, `FloatingCams`, `StatusBar`
  - `useFullscreen`, `useAutoHide`, `useToast`, `isUserCancel`
  - `PreJoin`, `JoinChoices`
  - `withRetry`, `FatalError`
  - `endLesson`, `PLAN_B_URL`
- Produces:
  - `<RoomShell lessonId member planBUrl />` (the root element carries `data-stage`)
  - `<LessonClient lessonId member planBUrl />`
  - `ROOM_OPTIONS: RoomOptions`
  - `SCREEN_CAPTURE: ScreenShareCaptureOptions`

- [ ] **Step 1: Add the room options**

`src/features/room/roomOptions.ts`:
```ts
import { ScreenSharePresets, VideoPresets, type RoomOptions, type ScreenShareCaptureOptions } from 'livekit-client';

export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
  publishDefaults: {
    simulcast: true,
    videoEncoding: VideoPresets.h540.encoding,
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
    red: true,
    dtx: true,
  },
};

export const SCREEN_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  contentHint: 'detail',
  resolution: ScreenSharePresets.h1080fps15.resolution,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'include',
};
```

- [ ] **Step 2: Add the room shell**

`src/features/room/RoomShell.tsx`:
```tsx
'use client';

import { RoomAudioRenderer, useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { RoomEvent, Track, type LocalTrackPublication, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endLesson } from '@/app/actions';
import { CameraTiles } from '@/features/stage/CameraTiles';
import { ScreenView } from '@/features/stage/ScreenView';
import type { Stage, SyncMessage } from '@/features/sync/protocol';
import { useSync } from '@/features/sync/useSync';
import type { Member } from '@/lib/lessons/types';
import { ControlBar } from './ControlBar';
import { FloatingCams } from './FloatingCams';
import { ExitFullscreenIcon, FullscreenIcon } from './icons';
import { isUserCancel } from './keys';
import { SCREEN_CAPTURE } from './roomOptions';
import {
  applyRemoteStage,
  initialStage,
  localStageChange,
  resolveVisibleStage,
  shouldStopLocalShare,
  stageAfterLocalShareEnded,
  type StageState,
} from './stage';
import { StatusBar } from './StatusBar';
import { useAutoHide } from './useAutoHide';
import { useFullscreen } from './useFullscreen';
import { useToast } from './useToast';

/** Stage modules built so far. Plans 2 and 3 add 'board' and 'media'. */
const AVAILABLE: readonly Stage[] = ['cameras', 'screen'];
const STAGE_LABEL: Record<Stage, string> = {
  cameras: 'the cameras',
  board: 'the board',
  screen: 'a shared screen',
  media: 'a video',
};

export function RoomShell({ lessonId, member, planBUrl }: { lessonId: string; member: Member; planBUrl: string }) {
  const room = useRoomContext();
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const [stage, setStage] = useState<StageState>(initialStage);
  const stageRef = useRef(stage);
  const toast = useToast();
  const fs = useFullscreen<HTMLDivElement>();
  const bar = useAutoHide(fs.active);

  const applyStage = useCallback((next: StageState) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const onMessage = useCallback(
    (msg: SyncMessage) => {
      if (msg.t !== 'stage') return;
      const prev = stageRef.current;
      const next = applyRemoteStage(prev, msg);
      if (next === prev) return;
      applyStage(next);
      if (next.stage !== prev.stage) {
        toast.show(`${msg.by === 'teacher' ? 'Teacher' : 'Student'} opened ${STAGE_LABEL[next.stage]}`);
      }
    },
    [applyStage, toast],
  );
  const send = useSync(onMessage);

  const changeStage = useCallback(
    (target: Stage) => {
      const next = localStageChange(stageRef.current, target, member.role);
      applyStage(next);
      void send({ t: 'stage', stage: next.stage, lamport: next.lamport, by: member.role });
    },
    [applyStage, member.role, send],
  );

  // Someone who joins late receives the current stage.
  useEffect(() => {
    const onJoin = (p: RemoteParticipant) => {
      const s = stageRef.current;
      if (s.by) void send({ t: 'stage', stage: s.stage, lamport: s.lamport, by: s.by }, { to: [p.identity] });
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
    };
  }, [room, send]);

  // One screen share at a time: the newest share wins.
  useEffect(() => {
    const onRemotePublished = (pub: RemoteTrackPublication) => {
      const lp = room.localParticipant;
      if (shouldStopLocalShare(lp.isScreenShareEnabled, pub.source === Track.Source.ScreenShare)) {
        void lp.setScreenShareEnabled(false);
      }
    };
    const onLocalUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      const remoteActive = [...room.remoteParticipants.values()].some((p) => p.isScreenShareEnabled);
      const next = stageAfterLocalShareEnded(stageRef.current.stage, remoteActive);
      if (next) changeStage(next);
    };
    room.on(RoomEvent.TrackPublished, onRemotePublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => {
      room.off(RoomEvent.TrackPublished, onRemotePublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    };
  }, [room, changeStage]);

  const toggleShare = useCallback(async () => {
    if (localParticipant.isScreenShareEnabled) {
      await localParticipant.setScreenShareEnabled(false);
      return;
    }
    try {
      await localParticipant.setScreenShareEnabled(true, SCREEN_CAPTURE);
      changeStage('screen');
    } catch (err) {
      if (!isUserCancel(err)) toast.show('Screen sharing failed. Try again, or share a single tab.');
    }
  }, [localParticipant, changeStage, toast]);

  const onEnd = useCallback(async () => {
    if (member.role === 'teacher') {
      try {
        await endLesson(lessonId);
      } catch {
        toast.show('Could not end the lesson. Check your connection and try again.');
        return;
      }
    }
    await room.disconnect();
  }, [member.role, lessonId, room, toast]);

  // A camera or mic that stops working mid-lesson.
  useEffect(() => {
    const onDeviceError = () => toast.show('Camera or microphone stopped working. Check it is plugged in, then turn it off and on.');
    room.on(RoomEvent.MediaDevicesError, onDeviceError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceError);
    };
  }, [room, toast]);

  const visible = resolveVisibleStage(stage.stage, { screenActive: screenTracks.length > 0, available: AVAILABLE });
  const renderBar = (compact: boolean) => (
    <ControlBar
      role={member.role}
      screenSharing={isScreenShareEnabled}
      onToggleShare={() => void toggleShare()}
      onEnd={() => void onEnd()}
      planBUrl={planBUrl}
      compact={compact}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StatusBar planBUrl={planBUrl} />
      <div ref={fs.ref} onMouseMove={bar.poke} data-stage={visible} className="relative flex min-h-0 flex-1 bg-paper">
        {visible === 'cameras' ? (
          <CameraTiles variant="stage" />
        ) : (
          <>
            <main className="min-w-0 flex-1">
              <ScreenView onStop={() => void localParticipant.setScreenShareEnabled(false)} />
            </main>
            {fs.active ? (
              <FloatingCams />
            ) : (
              <aside className="w-44 shrink-0 overflow-y-auto border-l border-line bg-surface">
                <CameraTiles variant="rail" />
              </aside>
            )}
          </>
        )}

        {(!fs.active || bar.visible) && (
          <button
            type="button"
            onClick={() => void fs.toggle()}
            title={fs.active ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
            aria-label={fs.active ? 'Exit fullscreen' : 'Fullscreen'}
            className={`absolute top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 shadow ${visible === 'cameras' || fs.active ? 'right-3' : 'right-48'}`}
          >
            {fs.active ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        )}

        {fs.active && bar.visible && <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">{renderBar(true)}</div>}

        {toast.message && (
          <div role="status" className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-sm text-paper shadow">
            {toast.message}
          </div>
        )}
      </div>
      {!fs.active && renderBar(false)}
      <RoomAudioRenderer />
    </div>
  );
}
```

- [ ] **Step 3: Add the lesson client (pre-join, then room)**

`src/app/lesson/[id]/LessonClient.tsx`:
```tsx
'use client';

import { LiveKitRoom } from '@livekit/components-react';
import { DisconnectReason, VideoPresets } from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PreJoin, type JoinChoices } from '@/features/prejoin/PreJoin';
import { ROOM_OPTIONS } from '@/features/room/roomOptions';
import { RoomShell } from '@/features/room/RoomShell';
import type { Member } from '@/lib/lessons/types';
import { FatalError, withRetry } from '@/lib/retry';

async function fetchToken(lessonId: string): Promise<{ token: string; url: string }> {
  const res = await fetch(`/api/token?lesson=${encodeURIComponent(lessonId)}`);
  const body = (await res.json().catch(() => ({}))) as { token?: string; url?: string; error?: string };
  if (res.ok && body.token && body.url) return { token: body.token, url: body.url };
  if (res.status >= 400 && res.status < 500) throw new FatalError(body.error ?? 'You cannot join this lesson.');
  throw new Error(body.error ?? 'The server did not answer.');
}

export function LessonClient({ lessonId, member, planBUrl }: { lessonId: string; member: Member; planBUrl: string }) {
  const router = useRouter();
  const [conn, setConn] = useState<{ token: string; url: string; choices: JoinChoices } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function join(choices: JoinChoices) {
    setError(null);
    try {
      const { token, url } = await withRetry(() => fetchToken(lessonId), { attempts: 3, baseDelayMs: 500 });
      setConn({ token, url, choices });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
    }
  }

  function onDisconnected(reason?: DisconnectReason) {
    if (reason === DisconnectReason.ROOM_DELETED) router.push('/?ended=1');
    else if (reason === DisconnectReason.CLIENT_INITIATED) router.push('/');
    else {
      setConn(null);
      setError('You were disconnected. Join again, or use Plan B.');
    }
  }

  if (!conn) {
    return <PreJoin lessonId={lessonId} role={member.role} error={error} planBUrl={planBUrl} onJoin={join} />;
  }

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      options={
        conn.choices.audioOutputId
          ? { ...ROOM_OPTIONS, audioOutput: { deviceId: conn.choices.audioOutputId } }
          : ROOM_OPTIONS
      }
      audio={conn.choices.audioEnabled ? { deviceId: conn.choices.audioDeviceId } : false}
      video={
        conn.choices.videoEnabled
          ? { deviceId: conn.choices.videoDeviceId, resolution: VideoPresets.h540.resolution }
          : false
      }
      onDisconnected={onDisconnected}
    >
      <RoomShell lessonId={lessonId} member={member} planBUrl={planBUrl} />
    </LiveKitRoom>
  );
}
```

- [ ] **Step 4: Render the client from the lesson page**

In `src/app/lesson/[id]/page.tsx`, add these imports:
```tsx
import { PLAN_B_URL } from '@/lib/env';
import { LessonClient } from './LessonClient';
```

Then replace the last line:
```tsx
  return <main className="p-6">Room for {lesson.title} (Task 10)</main>;
```
with:
```tsx
  return <LessonClient lessonId={lesson.id} member={member} planBUrl={PLAN_B_URL} />;
```

- [ ] **Step 5: Run unit tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Manual two-browser check (covers the hooks the unit tests cannot)**

Run `npm run dev`. Use a normal window for the teacher and a private window for the student.

1. Teacher starts the lesson and goes through pre-join.
   Expected: camera preview, moving mic bar, test sound plays, and "Your student hasn't joined yet".
2. Student opens `/`, clicks Join lesson, and sees "Teacher is in the room" within 5 seconds, then joins.
   Expected: both see 2 camera tiles side by side (layout B).
3. Teacher clicks Share and picks a **tab**.
   Expected: the student sees the shared screen with the cameras on the right (layout D) and a toast "Teacher opened a shared screen".
4. Student clicks Share while the teacher is sharing.
   Expected: the teacher's share stops, the student's share shows, and the stage stays on the screen; it does not flip to cameras.
5. Student clicks Stop sharing.
   Expected: both return to cameras.
6. Teacher shares the **entire screen**.
   Expected: the teacher sees "Your preview is hidden…", and the student sees the screen.
7. Press F (with no text field focused).
   Expected: fullscreen with floating cameras that can be dragged and hidden. The slim bar appears on mouse move and hides after 3 seconds. Esc exits.
8. Turn the student's Wi-Fi off for 10 seconds.
   Expected: yellow "Reconnecting…" on the student's side, which clears when Wi-Fi is back. Keep it off for more than 30 seconds: "Open Plan B" appears.
9. Turn the student's camera off.
   Expected: the teacher sees the letter "S" instead of video.
10. Teacher clicks End, then "Click again".
    Expected: the student lands on `/?ended=1`, showing "The lesson has ended.", and the teacher lands on home.

Fix anything that fails before committing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(room): wire pre-join, stage sync, screen share and end flow"
```

---

### Task 11: Keep-alive and deploy

**Files:**
- Create: `src/app/api/keepalive/route.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `adminClient()`, `serverEnv()`.
- Produces: `GET /api/keepalive`, which returns 200 `{ ok: true }` with a valid `Authorization: Bearer $CRON_SECRET` and 401 otherwise. A daily Vercel cron calls it.

- [ ] **Step 1: Add the route and the cron config**

`src/app/api/keepalive/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { adminClient } from '@/lib/supabase/admin';

// Supabase pauses free projects after 7 days without activity; one query a day prevents it.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${serverEnv().cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const { error } = await adminClient().from('lessons').select('id', { head: true, count: 'exact' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

`vercel.json`:
```json
{
  "crons": [{ "path": "/api/keepalive", "schedule": "0 6 * * *" }]
}
```

- [ ] **Step 2: Verify locally**

With `npm run dev` running:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/keepalive
curl -s -H "Authorization: Bearer $(grep ^CRON_SECRET .env.local | cut -d= -f2)" http://localhost:3000/api/keepalive
```
Expected: `401`, then `{"ok":true}`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ops): daily keep-alive cron for Supabase"
```

- [ ] **Step 4 (USER ACTION, guided): Create a private GitHub repo and push**

Ask the user before doing this; it publishes code to GitHub. With approval:
```bash
gh repo create ma-classe --private --source . --push
```

- [ ] **Step 5 (USER ACTION, guided): Import into Vercel**

1. At https://vercel.com/new, import `ma-classe`. Set the project name to the chosen `<name>` so the URL is `<name>.vercel.app`.
2. Under Environment Variables (Production), use the **production** Supabase values:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - `NEXT_PUBLIC_PLAN_B_URL`
   - `CRON_SECRET` (a new random value)
   - **Do not set** `NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN`.
3. Deploy.

- [ ] **Step 6: Verify production**

1. Open `https://<name>.vercel.app`.
   Expected: the login page with only "Sign in with Google".
2. Sign in with a Google account that is **not** on the list.
   Expected: Google blocks it (Testing mode) or the app shows "This classroom is private."
3. Sign in with `huynhluan491@gmail.com`.
   Expected: the student home page.
4. In Vercel → Settings → Cron Jobs, run the job manually.
   Expected: a 200 status in the logs.

---

### Task 12: Two-browser end-to-end test

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/lesson.spec.ts`

**Interfaces:**
- Consumes:
  - The UI labels "Sign in with password", "Start lesson", "Join lesson", "End lesson", "Click again to end", and "The lesson has ended."
  - `data-testid="camera-tile"` and `data-stage`.
  - `.env.local` (dev project).

- [ ] **Step 1: Add the Playwright config**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile('.env.local');
} catch {
  // CI provides the variables directly.
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3000',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Write the test**

`e2e/lesson.spec.ts`:
```ts
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type Page } from '@playwright/test';

const TEACHER = { email: process.env.E2E_TEACHER_EMAIL!, password: process.env.E2E_TEACHER_PASSWORD! };
const STUDENT = { email: process.env.E2E_STUDENT_EMAIL!, password: process.env.E2E_STUDENT_PASSWORD! };

test.beforeEach(async () => {
  // A failed earlier run can leave a live lesson; end it so "Start lesson" shows.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await admin
    .from('lessons')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('status', 'live');
  if (error) throw error;
});

async function signedInPage(browser: Browser, who: typeof TEACHER): Promise<Page> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in with password' }).click();
  await page.waitForURL('http://localhost:3000/');
  return page;
}

test('teacher and student meet on camera, then the teacher ends the lesson', async ({ browser }) => {
  const teacher = await signedInPage(browser, TEACHER);
  const student = await signedInPage(browser, STUDENT);

  await teacher.getByRole('button', { name: 'Start lesson' }).click();
  await teacher.waitForURL(/\/lesson\/[0-9a-f-]+$/);
  await teacher.getByRole('button', { name: 'Join lesson' }).click();

  await student.reload();
  await student.getByRole('link', { name: 'Join lesson' }).click();
  await expect(student.getByText('Teacher is in the room')).toBeVisible({ timeout: 15_000 });
  await student.getByRole('button', { name: 'Join lesson' }).click();

  await expect(teacher.getByTestId('camera-tile')).toHaveCount(2, { timeout: 30_000 });
  await expect(student.getByTestId('camera-tile')).toHaveCount(2, { timeout: 30_000 });
  await expect(student.locator('[data-stage]')).toHaveAttribute('data-stage', 'cameras');

  await teacher.getByRole('button', { name: 'End lesson' }).click();
  await teacher.getByRole('button', { name: 'Click again to end' }).click();

  await student.waitForURL(/\/\?ended=1$/, { timeout: 30_000 });
  await expect(student.getByText('The lesson has ended.')).toBeVisible();
});

test('a student cannot join a lesson that has ended', async ({ browser }) => {
  const teacher = await signedInPage(browser, TEACHER);
  await teacher.getByRole('button', { name: 'Start lesson' }).click();
  await teacher.waitForURL(/\/lesson\/[0-9a-f-]+$/);
  const lessonUrl = teacher.url();

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  await admin.from('lessons').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('status', 'live');

  const student = await signedInPage(browser, STUDENT);
  await student.goto(lessonUrl);
  await expect(student.getByText('This lesson has ended.')).toBeVisible();
});
```

- [ ] **Step 3: Install the browser and run**

```bash
npx playwright install chromium
npm run e2e
```
Expected: 2 passed. These tests use the **dev** Supabase project and LiveKit Cloud; each run costs about 2 participant-minutes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e): two-browser lesson flow and ended-lesson guard"
```

---

## After Plan 1

Run one real practice lesson with the teacher on production: layouts A, B, D, F and G, one screen share each, and one Wi-Fi drop. Then write Plan 2 (Board) from spec sections 6 and 9.
