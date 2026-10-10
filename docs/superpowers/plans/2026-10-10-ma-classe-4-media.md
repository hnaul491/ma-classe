# Ma Classe — Plan 4: Google Drive Import and Synced Media

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring PDFs, images, Google Slides and Google Docs from Google Drive onto the board. Add a synced media stage, so YouTube videos and audio files play, pause and seek together for both people.

**Architecture:**
- **Google access.** Each browser gets its own short-lived Google token on demand, through Google Identity Services (GIS). The token is never stored on the server.
- **Drive Picker.** The Picker returns a file.
  - Slides and Docs are exported to PDF.
  - PDFs and images are downloaded.
  - Both then go through the existing board pipeline (`renderPdf` / `imageToWebp` → `placePages`).
  - Audio files become a media item.
- **Media stage.** It is a new stage module (`media`), kept mounted like the board. Media sync uses the existing board-style LiveKit data channel on a new topic, `ma-classe-media`:
  - The person who acts broadcasts load, play, pause and seek messages, each carrying the position and the send time.
  - While a video plays, the person who last acted re-broadcasts the position every 5 s.
  - A receiver that drifts by more than 1 s seeks to match.
- **YouTube** plays through the IFrame Player API.
- **Audio** plays through an `<audio>` element. Each browser downloads the audio from Drive with its own token.
- Videos stored in Drive are not synced. The teacher shares the tab with tab audio instead (spec §7).

**Tech Stack:**
- Next.js 16.4, React 19, `livekit-client` 2.22.4
- Google Identity Services (`https://accounts.google.com/gsi/client`)
- Google Picker (`https://apis.google.com/js/api.js`)
- Drive REST v3
- YouTube IFrame API (`https://www.youtube.com/iframe_api`)
- Vitest 5

**Spec:** `docs/superpowers/specs/2026-10-10-ma-classe-design.md` §5 layout E, §7 Documents and media, §9 `media` topic.

> **Simplification (ruling):** the spec's "every upload also goes to the Drive class folder" is deferred. Board uploads stay as they are, in Supabase only. Drive is an **import source** for the board and for audio. This keeps Google sign-in pop-ups out of the live lesson unless someone actually picks from Drive. Section 7 of the spec is updated in Task 1.

## Global Constraints

- **Google scope:** `https://www.googleapis.com/auth/drive.readonly`. The OAuth app stays in **Testing** mode with only the 2 members as test users, so no Google verification is needed.
- **Google config:** the client id, API key and app id come from `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY` and `NEXT_PUBLIC_GOOGLE_APP_ID`.
  - If any of these is missing, the Drive buttons are hidden. Nothing crashes.
- **Drive file types:**
  - **PDF:** limited to 30 MB and 50 pages. Same rules as uploads.
  - **Google Docs / Slides:** exported as PDF. Drive's export limit is 10 MB; above that, show "Export this file as PDF first".
  - **Images:** PNG, JPG or WebP.
  - **Audio:** MP3, M4A, WAV or OGG, up to 50 MB.
  - **Video files from Drive:** show "Share the tab with sound instead". Not synced.
- **YouTube:** accept `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/` and `youtube.com/embed/` URLs. The video id must be exactly 11 characters from `[A-Za-z0-9_-]`.
- **Media sync rules:**
  - drift threshold 1 s;
  - heartbeat every 5 s while playing;
  - every message carries `sentAt` (ms) and the receiver compensates `position += (now - sentAt)/1000` while playing.
- **Autoplay blocked by the browser:** show a "Click to play" overlay. It joins at the current position.
- **Stages and UI:**
  - The stage stays shared. Media opens for both people.
  - The control bar gets a **Media** button between Share and Chat.
  - UI copy is in EN/FR (gender-neutral FR), with the shared `.btn`, `.field` and `.card` classes.
- **Code hygiene:** exact versions (no new npm packages expected; Google scripts load from their URLs), pristine tests, 0 lint errors.

**User actions (Task 1):** Google Cloud settings and the three env vars, in Vercel and in `.env.local`.

## Review Focus

1. **Seek and play on different machines.** The other person ends up within 1 s of the sender, even with 200–300 ms network delay (Taiwan ↔ France). Covered by `targetPosition` / `needsCorrection` tests.
2. **Bad YouTube URLs.** A playlist URL, a channel URL or random text gives a clear message and does not break the player. Covered by `parseYouTubeId` tests.
3. **Unsupported Drive files** (a Google Sheet, an MP4, a 15 MB Doc). Each gets a clear message and nothing is placed on the board. Covered by `classifyDriveFile` tests.
4. **Expired Google token** (after about 1 h). The next Drive action asks for a token again instead of failing with 401. Covered by `tokenValid` tests and a 401 retry in `driveFetch`.
5. **Late joiner or reload during playback.** They receive the current media and position. Covered by the `media-req` → `media-state` reply and a `mediaReducer` test.

---

### Task 1: Google setup, env and spec update

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/env.ts`, adding `googleConfig()`
- Modify: `docs/superpowers/specs/2026-10-10-ma-classe-design.md` §7
- Test: `src/lib/env.test.ts`

**Interfaces (produces):** `googleConfig(): { clientId: string; apiKey: string; appId: string } | null`. It returns `null` if any value is missing. It reads the `NEXT_PUBLIC_*` values through static `process.env.NEXT_PUBLIC_GOOGLE_…` references, so Next can inline them.

- [ ] **Step 1 (USER ACTION, guided).** In Google Cloud project `ma-classe`:
  1. **APIs & Services → Library:** enable **Google Drive API** and **Google Picker API**.
  2. **Credentials → Create credentials → API key.** Restrict it as follows:
     - Application restrictions: *Websites*, with `https://ma-classe-mocha.vercel.app/*` and `http://localhost:3000/*`.
     - API restrictions: Drive API and Picker API.
  3. **Credentials → the existing OAuth Web client → Authorized JavaScript origins:** add `https://ma-classe-mocha.vercel.app` and `http://localhost:3000`.
  4. **OAuth consent screen → Data access / Scopes:** add `…/auth/drive.readonly`. Keep the app in **Testing**, with the 2 test users.
  5. **Find the values:**
     - Project **number** (Dashboard): this is the `APP_ID`.
     - The OAuth client id: this is the `CLIENT_ID`.
     - The API key: this is the `API_KEY`.

     Put all three in Vercel env (Production) and in `.env.local`.
- [ ] **Step 2: Test first, then implement `googleConfig()`.**
- [ ] **Step 3: Update spec §7.** Replace the "Drive class folder" paragraph with the import-source design above, and record the deferral.
- [ ] **Step 4: Verify and commit.** Commit message: `feat(drive): google config and spec update`.

### Task 2: Google token and Drive client (pure parts tested)

**Files:**
- Create: `src/features/drive/token.ts`
- Create: `src/features/drive/drive.ts`
- Create: `src/features/drive/classify.ts`
- Create the tests for all three.

**Interfaces (produces):**
- `tokenValid(t: { accessToken: string; expiresAt: number } | null, now: number): boolean`
  - Returns `true` only when `expiresAt - now > 60_000`.
- `getDriveToken(): Promise<string>`
  - Loads the GIS script once.
  - Caches the token in memory with its `expiresAt`, and reuses it while `tokenValid`.
  - Otherwise calls `initTokenClient({ client_id, scope, callback }).requestAccessToken({ prompt: '' })`.
  - Rejects with `DriveAuthError` if the user cancels.
- `clearDriveToken(): void`
- `driveFetch(path: string, init?: RequestInit): Promise<Response>`
  - Calls `https://www.googleapis.com/drive/v3/…` with `Authorization: Bearer`.
  - On a 401 it calls `clearDriveToken()`, gets a fresh token and retries once.
- `type DriveFile = { id: string; name: string; mimeType: string; sizeBytes: number | null }`
- `classifyDriveFile(f: DriveFile)` returns one of:
  - `{ kind: 'pdf' }`
  - `{ kind: 'export-pdf' }`, for Docs and Slides
  - `{ kind: 'image' }`
  - `{ kind: 'audio' }`
  - `{ kind: 'reject'; reason: 'drive.video' | 'drive.unsupported' | 'drive.tooLarge' }`
  - Its rules follow the Global Constraints. Google-native files have `sizeBytes = null`; the 10 MB export limit surfaces as an export error, handled in Task 3.
- `downloadDriveFile(f: DriveFile): Promise<File>`
  - Uses `files/{id}?alt=media`, or `files/{id}/export?mimeType=application/pdf` for `export-pdf`.
  - Returns a `File` named after `f.name` (with `.pdf` appended for exports) and of the correct type.
  - Export over 10 MB (403 `exportSizeLimitExceeded`) → throws `DriveExportTooLarge`.
- `openDrivePicker(): Promise<DriveFile | null>`
  - Loads the `api.js` script once and runs `gapi.load('picker')`.
  - Builds `DocsView(ViewId.DOCS)` with folders shown, using the token, `setDeveloperKey` and `setAppId`.
  - Returns `{ id, name, mimeType, sizeBytes }` from `picked.docs[0]`, or `null` if the user cancels.
  - Picker size field: `sizeBytes` is a string on `docs[0]`. Parse it, or use `null`.

Tests:
- `tokenValid` boundaries.
- `classifyDriveFile` for every listed mime: pdf; Docs, Slides and Sheets; png/jpeg/webp; mp3/m4a/wav/ogg; mp4/quicktime; a 60 MB audio file; a 40 MB PDF.
- `driveFetch` 401 retry, with an injectable `fetch` and token getter so it is unit-testable.

Commit message: `feat(drive): token, picker, drive fetch and file classification`.

### Task 3: Drive import on the board

**Files:**
- Modify: `src/features/stage/Board.tsx`, adding an Add menu item **From Google Drive**
- Modify: `src/lib/i18n/messages.ts`

**Behaviour:**
1. The menu item is shown only when `googleConfig()` is set.
2. On click, call `openDrivePicker()`, then `classifyDriveFile`:
   - `pdf` / `export-pdf` → `downloadDriveFile` → the existing PDF path, the same as an upload.
   - `image` → the image path.
   - `audio` → `onOpenMedia({ kind: 'audio', drive: file })`, a new optional prop. RoomShell switches the stage to media and loads it.
   - `reject` → toast with the reason.
3. Errors map to toasts:
   - `DriveAuthError` → `drive.authCancelled`
   - `DriveExportTooLarge` → `drive.exportTooLarge`
   - anything else → `drive.failed`
4. Add these keys in EN and FR:
   - `board.addFromDrive`
   - `drive.video`
   - `drive.unsupported`
   - `drive.tooLarge`
   - `drive.exportTooLarge`
   - `drive.authCancelled`
   - `drive.failed`

Commit message: `feat(drive): add files from Google Drive to the board`.

### Task 4: Media sync logic (pure)

**Files:**
- Create: `src/features/media/protocol.ts`
- Create: `src/features/media/sync.ts`
- Create the tests for both.

**Interfaces (produces):**
- `MEDIA_TOPIC = 'ma-classe-media'`
- `type MediaSource = { kind: 'youtube'; videoId: string; title?: string } | { kind: 'audio'; driveId: string; name: string; mimeType: string }`
- `type MediaMessage =`
  - `| { t: 'media-load'; source: MediaSource; at: number }`
  - `| { t: 'media-state'; source: MediaSource | null; playing: boolean; position: number; sentAt: number; lamport: number }`
  - `| { t: 'media-req' }`
- `encodeMedia` / `decodeMedia`. These are versioned and strictly validated:
  - a YouTube id must match `/^[A-Za-z0-9_-]{11}$/`;
  - an audio mime must be one of the allowed types;
  - `position` must be finite and ≥ 0.
- `parseYouTubeId(input: string): string | null`, for the URL forms in the Global Constraints. A playlist-only URL, a channel URL or garbage returns `null`.
- `targetPosition(s: { playing: boolean; position: number; sentAt: number }, now: number): number`
  - Returns `position + (playing ? (now - sentAt)/1000 : 0)`, clamped to ≥ 0.
- `needsCorrection(local: number, target: number, thresholdSec = 1): boolean`
- `type MediaState = { source: MediaSource | null; playing: boolean; position: number; sentAt: number; lamport: number }`
- `mediaReducer(s: MediaState, a: { type: 'local'; next: Omit<MediaState, 'lamport'> } | { type: 'remote'; msg: Extract<MediaMessage, { t: 'media-state' }> }): MediaState`
  - A local action bumps the lamport.
  - A remote message is applied only when its lamport is higher.
  - When the lamports are equal, the larger `sentAt` wins.

Tests cover:
- every YouTube URL form, plus the bad cases;
- decode robustness;
- `targetPosition` with 250 ms of latency;
- `needsCorrection` at the threshold;
- the reducer's ordering, including a late joiner adopting state.

Commit message: `feat(media): media sync protocol and drift maths`.

### Task 5: Media stage and player

**Files:**
- Create: `src/features/media/useMediaChannel.ts`, the same pattern as `useBoardChannel`, on `MEDIA_TOPIC`
- Create: `src/features/media/YouTubePlayer.tsx`
- Create: `src/features/media/AudioPlayer.tsx`
- Create: `src/features/stage/MediaStage.tsx`
- Modify: `src/features/room/RoomShell.tsx`, `ControlBar.tsx` and `icons.tsx`
- Modify: `src/lib/i18n/messages.ts`

**Behaviour:**
- **The `MediaStage` component:**
  - Stays mounted, hidden when not on stage, like the board.
  - Holds `mediaReducer` state.
  - When nothing is loaded, it shows:
    - a YouTube URL field (`.field`) and a **Play together** button;
    - when Drive is configured, a **Audio from Google Drive** button, which opens the picker restricted to audio.
- **Loading media:**
  - A YouTube URL is checked with `parseYouTubeId`. A bad URL shows `media.badUrl` and nothing else happens.
  - Loading media broadcasts `media-load`, then a `media-state` with `playing: false` and `position: 0`.
- **Playback controls:**
  - Use the player's own controls, wired through events.
  - **YouTube:** `onStateChange` PLAYING or PAUSED, and seeks detected through `getCurrentTime` jumps, become local actions. Ignore events caused by applying a remote state, using an `applying` flag with a 500 ms window.
  - **Audio:** `play`, `pause` and `seeked` events become local actions.
  - **Audio loading:** each browser downloads its own copy with `downloadDriveFile`, then uses an object URL. Revoke the URL on change or unmount.
- **Sync:**
  - While playing, the person who last acted sends a `media-state` heartbeat every 5 s.
  - Each receiver computes `targetPosition`. If `needsCorrection`, it seeks.
  - On mount, on `Connected` and on `ParticipantConnected`, send `media-req`. The other side answers with its current `media-state`, sent to that identity.
- **Autoplay blocked:**
  - YouTube: `playVideo()` does not reach PLAYING within 1.5 s.
  - Audio: `play()` rejects.
  - In both cases, show a **Click to play** overlay (`media.clickToPlay`). It plays from the current `targetPosition`.
- **Closing:** a small **Close media** button clears the source for both people (`media-state` with `source: null`), then switches the stage back to cameras.
- **Control bar:** a Media button between Share and Chat. Label `bar.media`, or `bar.closeMedia` when active. `aria-pressed`.
- **RoomShell:**
  - `AVAILABLE` includes `'media'`.
  - `MediaStage` is loaded dynamically with `ssr: false` and stays mounted.
  - `onOpenMedia` from the Board switches to the media stage and loads the Drive audio.
- **i18n keys (EN/FR):**
  - `media.urlLabel`, `media.play`, `media.fromDrive`, `media.badUrl`, `media.clickToPlay`, `media.close`
  - `bar.media`, `bar.closeMedia`
  - `media.loading`, `media.failed`

Commit message: `feat(media): synced YouTube and audio player stage`.

---

## After Plan 4

Do the manual check with two people: YouTube play/pause/seek in sync, a reload mid-video rejoining at the right spot, Drive Slides → board pages, and Drive audio played in sync. Then write Plan 5: vocabulary, the past-lesson review page and the usage meter.
