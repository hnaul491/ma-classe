# Ma Classe — Design Spec

Date: 2026-10-10
Status: Draft, awaiting review
Visual proposal: https://claude.ai/artifact/C75p9yAsAhy91vZFwofUcF

## 1. Purpose

A private web classroom for exactly two people: a French teacher and one student. Modeled on Preply's classroom, without the marketplace. The priority is a call that does not break during a lesson, plus a shared board for writing and showing documents.

**Success:** a full 90-minute lesson runs in Ma Classe instead of Zoom + Google Docs, with no drop that forces a switch to another tool, and afterwards the lesson's board, chat, and vocabulary can be reopened.

## 2. Scope

### In scope (v1)

- Google sign-in, restricted to 2 allowlisted emails (teacher, student).
- Pre-join device check (camera, mic, speaker).
- 1-on-1 video and audio call, screen share (entire screen, window, or tab, with tab audio).
- Shared stage with layouts A–G (section 5).
- Shared whiteboard (Excalidraw) with an accent bar, follow-teacher, laser pointer, and PDF/image pages with page jump.
- Documents: PDF and image upload; Google Slides and Google Docs from Drive (exported to PDF); PDF and images from Drive.
- Synced media player: audio files, video files, YouTube.
- Chat and vocabulary panel during a lesson.
- Lesson history: board, chat, and vocab saved per lesson; read-only review page.
- Vocabulary page: all words, search, "hide meaning" self-quiz.
- Reliability features: auto-reconnect UI, Plan B link, usage meter, DB keep-alive.

### Out of scope (v1)

Call recording, AI summaries, flashcards or spaced repetition, mobile or tablet layouts, stylus support, more than 2 users, scheduling, payments, custom domain, direct conversion of Office files (`.pptx`, `.docx`); the user exports these to PDF.

## 3. Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Build vs glue | Own app | Glued Jitsi + Excalidraw tabs give no PDFs on the board, no synced media, and no lesson history. The free Jitsi embed is limited to 5 minutes. |
| Board | Excalidraw (MIT) | Free forever, no license key. tldraw's free hobby license is discretionary, has an unclear expiry, and with an invalid key it "after five seconds, stops rendering the editor". |
| Hosting | Managed free plans | No servers to maintain. LiveKit's free plan lists the same 99.99% uptime as its paid plans. |
| Board sync transport | LiveKit data channel | One less service than Liveblocks. If the call is connected, the board is connected too. |
| Address | `<name>.vercel.app` | Free; a custom domain is not needed for 2 users. |
| Video quality | Capped at 540p | Keeps usage well inside the free data allowance. Faces are small; the board is the main content. |

The board is isolated behind a `Board` stage module (section 8), so it could be swapped later without touching the rest of the app.

## 4. Services and cost

| Service | Plan | Used for | Cost |
|---|---|---|---|
| Vercel | Hobby | Next.js app, API routes, daily cron | €0 |
| LiveKit Cloud | Build | WebRTC SFU, TURN relays, data channels | €0 |
| Supabase | Free | Auth (Google), Postgres, Storage | €0 |
| Google Cloud project | No billing | OAuth client, Drive Picker, Drive API | €0 |

No account has a payment card attached, so nothing can bill. If a free limit is reached, the service is limited until the next month or asks for an upgrade. It cannot charge without a card. The usage meter (section 12) warns well before that.

Limits verified 2026-10-10:

- LiveKit Build: 5,000 WebRTC minutes, 50 GB downstream, 100 concurrent connections per month.
- Supabase Free: 500 MB database, 1 GB file storage, projects pause after 1 week of inactivity.

Expected use: 2 lessons a week × 90 minutes × 2 people, so 9–10 lessons a month.

| Limit | Expected use | Share of free limit |
|---|---|---|
| LiveKit video minutes | ~1,800 participant-minutes | ~36% |
| LiveKit downstream data (540p) | ~11 GB | ~22% |

The free plan covers about 27 such lessons a month.

## 5. Screens and layouts

### Pages

| Route | Who | Content |
|---|---|---|
| `/login` | Anyone | Google sign-in button. Non-members are signed out and see "This classroom is private." |
| `/` | Members | **Teacher:** Start lesson. **Student:** Join, enabled only while a lesson is live. Both see a list of past lessons, a link to Vocabulary, and the usage meter. |
| `/lesson/[id]` | Members | Pre-join (layout A), then the room. |
| `/lesson/[id]/review` | Members | Read-only board snapshot, chat, and vocab of an ended lesson. |
| `/vocab` | Members | All words, search, "hide meaning" toggle, edit. |

### Room layouts

The **stage** (main area) shows one thing at a time. Cameras are always visible.

| Id | Layout | Stage content | Cameras |
|---|---|---|---|
| A | Pre-join | Own camera preview, mic level meter, camera, mic, and speaker selectors with a test sound, "Teacher is in the room" status, Join button | — |
| B | Cameras only | Two equal tiles | On the stage |
| C | Board | Excalidraw with the toolbar | Right column, with Chat/Vocab tabs below |
| D | Screen share | Remote or own shared screen, with a "Stop sharing" bar for the sharer | Right column |
| E | Media | Synced player; "Shrink" turns it into a floating mini player over the board. Audio-only clips play as a thin strip above the board instead of taking the stage. | Right column |
| F | Problem | Current layout plus a yellow status bar ("Reconnecting… your board is saved"). A camera that is off shows an initial. After 30 seconds of failure, Plan B is suggested. | As current |
| G | Fullscreen | Current stage fills the monitor (Fullscreen API). Cameras become 2 draggable, hideable floating tiles. A slim icon bar appears on mouse move and hides after 3 seconds. Opened with F, closed with Esc. | Floating |

### Layout rules

1. **One thing on the stage.** Opening one replaces the last. Each module keeps its state while hidden.
2. **The stage is shared.** A stage change by either user applies to both, and a toast shows who made it.
3. **Fullscreen is personal.** G is local to each user and is not synced.
4. **Files go to the board.** Insert → Upload or From Drive switches the stage to the board and places the document there.
5. **One screen share at a time.** A new share replaces the existing one.
6. **Sharing the entire screen** hides the sharer's own preview (no mirror effect) and shows a tip to turn off notifications.
7. **Control bar.** Icon-only, the same everywhere, in this order: Mic · Camera | Board · Share · Media | Chat ··· Plan B · End/Leave. Every icon has a tooltip; the active stage icon is highlighted. The teacher's red button is End lesson (saves and closes the lesson); the student's is Leave.

### Languages

The interface is available in English and French (added 2026-10-10). Each person picks a language with a switch on the login page and the home page. The choice is remembered per browser in a `lang` cookie. Without a cookie, the browser language decides: French if it starts with `fr`, otherwise English. French copy is gender-neutral ("Votre prof", "Votre élève"). Lesson dates are shown in the viewer's language, in Paris time.

## 6. Board features

- **Tools:** Excalidraw defaults (select, pen, text, highlighter, arrow, shapes, eraser) plus the built-in laser pointer.
- **Accent bar:** é è ê ë à â ç ù û î ï ô œ, and capitals with Shift. A click inserts the character at the cursor of the focused text input: the board text editor, chat, or vocab field. Focus does not move.
- **PDF pages:** pdf.js renders each page at about 150 DPI to PNG and uploads it to Storage. Each page becomes an image element inside a frame named `Page n`, stacked vertically. Maximum 50 pages per file; larger files show an error asking the user to split the file.
- **Page jump:** buttons 1…n in the toolbar scroll to a frame. When the teacher jumps, the student follows if follow mode is on.
- **Follow teacher:** the student's view tracks the teacher's scroll and zoom. Any manual pan or zoom by the student pauses following and shows a "Resume following" chip.
- **Images:** inserted as image elements at the center of the view.

## 7. Documents and media

| Source | Handling |
|---|---|
| Upload PDF | PDF import (section 6) |
| Upload image (PNG, JPG, WebP) | Uploaded to Storage, inserted on the board |
| Drive: Google Slides / Docs | Picker (`drive.file` scope) → Drive API `files.export` to `application/pdf` → PDF import |
| Drive: PDF / image | Picker → download → same as upload |
| Drive: `.pptx` / `.docx` | v1: message "Export this file as PDF first" |
| Audio / video file | Uploaded to Storage; played by the synced player with a signed URL |
| YouTube link | Synced player using the YouTube IFrame Player API |

**Drive access:** the Google token for Drive is requested on demand through a Google Identity Services token client when the user opens the Picker. It is short-lived and never stored.

**Media sync:** whoever acts sends `{action: play|pause|seek, mediaId, position, sentAt}`. Receivers apply the action. While playing, the starter sends its position every 5 seconds, and a receiver that drifts by more than 1 second seeks to match.

## 8. Components

The app is a single Next.js (App Router, TypeScript) project:

```
src/
  app/
    login/page.tsx
    page.tsx                      # home
    lesson/[id]/page.tsx          # pre-join + room
    lesson/[id]/review/page.tsx
    vocab/page.tsx
    api/token/route.ts            # LiveKit access token
    api/keepalive/route.ts        # daily cron target
  features/
    auth/                         # session, member check, role
    prejoin/                      # device preview and selection
    room/                         # RoomShell, ControlBar, stage store, fullscreen, status bar
    stage/
      CameraGrid/
      Board/                      # Excalidraw wrapper, accent bar, page jump, follow, laser
      ScreenView/
      MediaPlayer/                # file player + YouTube player behind one interface
    sync/                         # protocol types, channel send/receive, board merge
    docs/                         # pdfImport, drivePicker, upload
    side/                         # Chat, Vocab
    usage/                        # usage meter
  lib/
    supabase/                     # browser and server clients
    livekit/
supabase/migrations/              # SQL schema + RLS
tests/                            # unit (Vitest) + e2e (Playwright)
```

Main libraries: `livekit-client`, `@livekit/components-react`, `livekit-server-sdk`, `@excalidraw/excalidraw`, `pdfjs-dist`, `@supabase/supabase-js`, `@supabase/ssr`. Exact versions are pinned in the implementation plan.

Every stage module receives the room and the sync channel through props or context and exposes nothing else. `RoomShell` does not import Excalidraw directly.

## 9. Sync protocol (LiveKit data)

Each message is JSON `{ v: 1, t: <topic>, ... }` sent on one LiveKit data topic (`ma-classe`). The sender is identified by its LiveKit participant identity (the member email). Messages with an unknown `v` or malformed fields are ignored.

| Topic | Payload | Reliability | Rate |
|---|---|---|---|
| `stage` | `{ stage: cameras\|board\|screen\|media, mediaId?, lamport }` | Reliable | On change |
| `board` | `{ elements: ExcalidrawElement[] }`, changed elements only | Reliable | Debounced to 50 ms |
| `board-files` | `{ fileId, storagePath, mimeType }` | Reliable | On insert |
| `board-sync-req` / `board-sync-res` | Request; response carries the full scene | Reliable | On join |
| `viewport` | `{ scrollX, scrollY, zoom }`, teacher only | Lossy | Max 10/s |
| `laser` | `{ x, y, tool }` → Excalidraw `collaborators` pointer | Lossy | Max 20/s |
| `media` | Section 7 | Reliable | On action + every 5 s |
| `chat` | `{ id }`; the row is already written to the DB, so the peer just refetches | Reliable | On send |

**Board merge:** element-level last-writer-wins by `version`, ties broken by `versionNonce`, using Excalidraw's reconcile helper. Deletions are elements with `isDeleted: true`.

**Large payloads:** a reliable data packet must stay under about 15 KB. Larger payloads, such as a full scene on join, use LiveKit text streams (automatic chunking). Binary files never go through the data channel; peers fetch them from Storage by path. The 15 KB limit and the text-stream API must be confirmed against the installed `livekit-client` version during planning.

**Stage conflicts:** a Lamport counter decides between two simultaneous stage changes; the higher value wins, and ties go to the teacher.

**Join or reload:** load `board_saves` for the lesson, then send `board-sync-req`. The peer answers with its scene, and the two are merged.

## 10. Data model (Supabase Postgres)

```sql
members      (email text pk check (email = lower(email)), role text check (role in ('teacher','student')) unique, display_name text)
lessons      (id uuid pk, title text, status text check (status in ('live','ended')), started_at timestamptz, ended_at timestamptz)
board_saves  (lesson_id uuid pk fk, scene jsonb, updated_at timestamptz, updated_by uuid)
files        (id uuid pk, lesson_id uuid fk, storage_path text, kind text, mime text, size_bytes bigint, page_count int, source text check (source in ('upload','drive')), name text, created_at timestamptz)
chat         (id uuid pk, lesson_id uuid fk, author_id uuid fk, body text, created_at timestamptz)
vocab        (id uuid pk, lesson_id uuid fk null, french text, meaning_vi text, meaning_en text, example text, created_by uuid, created_at timestamptz, updated_at timestamptz)
```

- Only one lesson can have `status = 'live'` at a time (partial unique index).
- The membership allowlist is seeded by SQL with the 2 emails (one per role). "Who is in the room" comes from LiveKit `listParticipants`, not the database.
- **Board saving:** the client that made the latest change upserts `board_saves` with a 3-second debounce, and again on End lesson. A failed save is retried from IndexedDB.
- **Storage:** private bucket `lesson-files/<lesson_id>/...`; files are read through signed URLs.

## 11. Auth and security

- Supabase Auth with Google. After sign-in, the server checks `members` by email. A non-member is signed out and redirected to `/login?denied=1`.
- RLS on every table: `using (is_member())`, where `is_member()` checks `auth.uid()` in `members`. Vocab insert is teacher-only; vocab update is open to both.
- Storage policies mirror the table RLS.
- `/api/token`:
  - verifies the Supabase session server-side;
  - requires membership and a `live` lesson matching `[id]`;
  - mints a LiveKit token with identity = member email, room = lesson id, grants `roomJoin`, `canPublish`, `canSubscribe`, `canPublishData`, and a TTL of 4 hours.
  - The LiveKit API secret exists only in Vercel environment variables.
- Lesson lifecycle: only the teacher can create a lesson (Start) or end it (End).
- No secrets in the client bundle except public keys (Supabase anon key, Google Picker API key restricted by HTTP referrer).

## 12. Reliability and error handling

| Failure | Behavior |
|---|---|
| Network blip | LiveKit auto-reconnect; layout F bar while `Reconnecting`; the board keeps working locally and syncs on reconnect |
| Strict firewall | LiveKit Cloud TURN over TLS/443 (built in) |
| Low bandwidth | Simulcast plus adaptive stream; audio prioritized; an audio-only toggle stops video publishing |
| Device failure | Caught in pre-join; in the room, a toast offers to switch device |
| Token fetch fails | 3 retries with backoff, then an error with a Plan B button |
| Reconnect fails for more than 30 s | Layout F suggests Plan B |
| Board save fails | IndexedDB queue, retried every 10 s, warning after 3 failures |
| Drive export fails | Toast: "Couldn't convert this file. Export it as PDF and upload it." |
| PDF over 50 pages or over 30 MB | Rejected before upload, with a message |
| Supabase pause | Vercel Cron calls `/api/keepalive` daily, which runs one trivial query |
| Free limit approaching | Usage meter on home warns at 70%. Minutes and data are estimated from lesson durations × 2 participants (× 540p bitrate for data); storage is the sum of `files.size_bytes`. |
| Bad deploy | Rule: no production deploys during lesson times. Recover with Vercel instant rollback. |
| Total failure | Plan B button opens a Google Meet link stored in config |

Media settings:

- Camera: 540p (`VideoPresets.h540`) with simulcast.
- Screen share: 1080p, 5–15 fps, `contentHint: 'detail'`, tab audio enabled where the browser supports it.

## 13. Testing

- **Unit (Vitest):** board merge, Lamport stage resolution, media drift correction, PDF import page layout math, accent insertion, usage estimate.
- **Integration:** `/api/token` rejects non-members, ended lessons, and missing sessions.
- **E2E (Playwright):**
  - two browser contexts with fake media devices against a local `livekit-server --dev` and a local Supabase;
  - checks stage sync, board element sync, reload recovery, follow mode, and chat;
  - runs in CI on every push.
- **Manual:** one practice lesson with the teacher before real use, covering every layout A–G, a PDF from Drive, YouTube sync, and pulling the network cable for 10 seconds.

## 14. Open items for the user

1. The teacher's Google email (for the allowlist).
2. The `vercel.app` subdomain name.
3. A Google Meet link for Plan B.
4. Create free accounts: Vercel, LiveKit Cloud, Supabase, Google Cloud (guided during implementation).

## 15. Sources (checked 2026-10-10)

- https://livekit.com/pricing
- https://supabase.com/pricing
- https://tldraw.dev/sdk-features/license-key
- https://tldraw.dev/get-a-license/hobby
