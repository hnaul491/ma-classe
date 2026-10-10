import { googleConfig } from '@/lib/env';
import { AUDIO_MAX_BYTES, DOC_MAX_BYTES } from '@/lib/limits';
import { classifyDriveFile, type DriveFile } from './classify';
import { loadScript } from './script';
import { clearDriveToken, DriveAuthError, DriveReauthRequired, getCachedDriveToken, getDriveToken } from './token';

export { DriveReauthRequired } from './token';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3/';
const PICKER_SRC = 'https://apis.google.com/js/api.js';

/** Drive refused to export a Google Doc / Slides file over its 10 MB export limit. */
export class DriveExportTooLarge extends Error {
  constructor() {
    super('This file is too large for Drive to export as PDF');
    this.name = 'DriveExportTooLarge';
  }
}

/** The file is over the limit for its kind (Content-Length, or the body once read). */
export class DriveFileTooLarge extends Error {
  constructor() {
    super('This file is too large');
    this.name = 'DriveFileTooLarge';
  }
}

/**
 * Drive answered a download with an error status. 403 and 404 mostly mean the file is not shared
 * with this Google account (the other person's file, played on the media stage).
 */
export class DriveHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Drive download failed (${status})`);
    this.name = 'DriveHttpError';
    this.status = status;
  }
}

export type DriveFetchDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  getToken: () => Promise<string>;
  clearToken: () => void;
};

export type DriveFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * A fetch for `https://www.googleapis.com/drive/v3/<path>` with the Google token. The path is always
 * appended to the Drive API, so the token never goes elsewhere. On a 401 (expired or revoked token)
 * it clears the token and throws DriveReauthRequired: it never opens a pop-up outside a click.
 */
export function createDriveFetch(deps: DriveFetchDeps): DriveFetch {
  const send = (url: string, token: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return deps.fetch(url, { ...init, headers });
  };
  return async (path, init) => {
    const url = DRIVE_API + path.replace(/^\/+/, '');
    const res = await send(url, await deps.getToken(), init);
    if (res.status !== 401) return res;
    deps.clearToken();
    throw new DriveReauthRequired();
  };
}

/** Drive fetch for a click: may open the Google pop-up for a new token. */
export const driveFetch: DriveFetch = createDriveFetch({
  fetch: (url, init) => fetch(url, init),
  getToken: getDriveToken,
  clearToken: clearDriveToken,
});

/**
 * Drive fetch outside a click (e.g. the download after a pick): never opens a pop-up, and throws
 * DriveReauthRequired when the token is missing or about to expire.
 */
export const driveFetchCached: DriveFetch = createDriveFetch({
  fetch: (url, init) => fetch(url, init),
  getToken: getCachedDriveToken,
  clearToken: clearDriveToken,
});

/**
 * The toast for a failed Drive import (pick or download). DriveReauthRequired is handled before
 * this: it shows a Reconnect button instead.
 */
export function driveErrorKey(e: unknown): 'drive.authCancelled' | 'drive.exportTooLarge' | 'drive.tooLarge' | 'drive.failed' {
  if (e instanceof DriveAuthError) return 'drive.authCancelled';
  if (e instanceof DriveExportTooLarge) return 'drive.exportTooLarge';
  if (e instanceof DriveFileTooLarge) return 'drive.tooLarge';
  return 'drive.failed';
}

/** The `reason` of a Drive JSON error body (`error.errors[0].reason`), or null. */
export async function driveErrorReason(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { errors?: { reason?: unknown }[] } };
    const reason = body?.error?.errors?.[0]?.reason;
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;
  }
}

/**
 * The file's content as a `File`: downloaded as is (PDF, image, audio), or exported to PDF (Docs and
 * Slides, named `<name>.pdf`). Throws DriveExportTooLarge over Drive's export limit, and
 * DriveFileTooLarge over the limit for its kind (audio 50 MB, others 30 MB): from Content-Length
 * before reading, otherwise as soon as the streamed bytes pass it. `signal` aborts the download. Never opens a pop-up (it runs after
 * the pick, outside the click): throws DriveReauthRequired instead.
 */
export async function downloadDriveFile(
  f: DriveFile,
  fetchDrive: DriveFetch = driveFetchCached,
  opts: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<File> {
  const kind = classifyDriveFile(f).kind;
  if (kind === 'reject') throw new Error(`Cannot import ${f.mimeType || 'this file'} from Drive`);
  // The other person's audio comes with no known size: the cap is checked here, before buffering.
  const maxBytes = opts.maxBytes ?? (kind === 'audio' ? AUDIO_MAX_BYTES : DOC_MAX_BYTES);
  const id = encodeURIComponent(f.id);
  const exporting = kind === 'export-pdf';
  const path = exporting ? `files/${id}/export?mimeType=application%2Fpdf` : `files/${id}?alt=media&supportsAllDrives=true`;
  const res = await (opts.signal ? fetchDrive(path, { signal: opts.signal }) : fetchDrive(path));
  if (!res.ok) {
    if (exporting && res.status === 403 && (await driveErrorReason(res)) === 'exportSizeLimitExceeded') throw new DriveExportTooLarge();
    throw new DriveHttpError(res.status);
  }
  const length = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > maxBytes) {
    void res.body?.cancel().catch(() => {});
    throw new DriveFileTooLarge();
  }
  const blob = await readCapped(res, maxBytes);
  if (!exporting) return new File([blob], f.name, { type: f.mimeType });
  const name = /\.pdf$/i.test(f.name) ? f.name : `${f.name}.pdf`;
  return new File([blob], name, { type: 'application/pdf' });
}

/**
 * The body as a Blob, counting bytes as they stream: over `maxBytes`, it cancels the stream and throws
 * DriveFileTooLarge without reading the rest (Drive may send no Content-Length). Without a body
 * stream (some environments), reads it whole and checks the size.
 */
async function readCapped(res: Response, maxBytes: number): Promise<Blob> {
  const type = res.headers.get('Content-Type') ?? '';
  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > maxBytes) throw new DriveFileTooLarge();
    return blob;
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DriveFileTooLarge();
    }
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
  return new Blob(chunks, { type });
}

/** A Picker document as a DriveFile (`sizeBytes` comes as a string), or null without an id. */
export function pickedFile(doc: unknown): DriveFile | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const d = doc as Record<string, unknown>;
  if (typeof d.id !== 'string' || d.id === '') return null;
  const size = typeof d.sizeBytes === 'string' && d.sizeBytes.trim() !== '' ? Number(d.sizeBytes) : d.sizeBytes;
  return {
    id: d.id,
    name: typeof d.name === 'string' ? d.name : '',
    mimeType: typeof d.mimeType === 'string' ? d.mimeType : '',
    sizeBytes: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null,
  };
}

export type PickerOutcome = { done: false } | { done: true; file: DriveFile | null };

/**
 * What a Picker callback means: keep waiting on `LOADED`; the picked file on `PICKED`; null for
 * `CANCEL` and any other action, so the promise never hangs.
 */
export function pickerOutcome(data: { action: string; docs?: unknown[] }, Action: { PICKED: string; LOADED: string }): PickerOutcome {
  if (data.action === Action.LOADED) return { done: false };
  if (data.action === Action.PICKED) return { done: true, file: pickedFile(data.docs?.[0]) };
  return { done: true, file: null };
}

let pickerApi: Promise<void> | null = null;

/** Loads `api.js`, then the Picker module, once per page. */
function loadPicker(): Promise<void> {
  pickerApi ??= loadScript(PICKER_SRC)
    .then(
      () =>
        new Promise<void>((resolve, reject) => {
          const gapi = window.gapi;
          if (!gapi) return reject(new Error('Google API script did not load'));
          gapi.load('picker', () => resolve());
        }),
    )
    .catch((e: unknown) => {
      pickerApi = null;
      throw e;
    });
  return pickerApi;
}

/**
 * Opens the Google Drive Picker (files and folders). Resolves with the picked file, or null when the
 * person cancels (or the Picker reports anything else). Call it from a click: it may need a Google
 * pop-up for the token. `mimeTypes` limits what is shown (e.g. audio only). Browser only.
 */
export async function openDrivePicker(opts: { mimeTypes?: readonly string[] } = {}): Promise<DriveFile | null> {
  const config = googleConfig();
  if (!config) throw new Error('Google Drive is not configured');
  const [token] = await Promise.all([getDriveToken(), loadPicker()]);
  const api = window.google?.picker;
  if (!api) throw new Error('Google Picker did not load');
  return new Promise<DriveFile | null>((resolve) => {
    const view = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true);
    if (opts.mimeTypes?.length) view.setMimeTypes(opts.mimeTypes.join(','));
    const picker = new api.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .addView(view)
      .setCallback((data) => {
        const outcome = pickerOutcome(data, api.Action);
        if (!outcome.done) return;
        resolve(outcome.file);
        picker.dispose();
      })
      .build();
    // The Picker attaches to the body, outside a fullscreen element, where it would be invisible.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    picker.setVisible(true);
  });
}
