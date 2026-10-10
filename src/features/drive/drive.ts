import { googleConfig } from '@/lib/env';
import { classifyDriveFile, type DriveFile } from './classify';
import { loadScript } from './script';
import { clearDriveToken, getDriveToken } from './token';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3/';
const PICKER_SRC = 'https://apis.google.com/js/api.js';

/** Drive refused to export a Google Doc / Slides file over its 10 MB export limit. */
export class DriveExportTooLarge extends Error {
  constructor() {
    super('This file is too large for Drive to export as PDF');
    this.name = 'DriveExportTooLarge';
  }
}

/**
 * Drive answered 401: the token expired or was revoked. The token is already cleared. Show a
 * "Reconnect Google Drive" button and retry from its click (a new token needs a pop-up, which
 * browsers block without a click).
 */
export class DriveReauthRequired extends Error {
  constructor() {
    super('Google Drive needs to be reconnected');
    this.name = 'DriveReauthRequired';
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

export const driveFetch: DriveFetch = createDriveFetch({
  fetch: (url, init) => fetch(url, init),
  getToken: getDriveToken,
  clearToken: clearDriveToken,
});

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
 * Slides, named `<name>.pdf`). Throws DriveExportTooLarge over Drive's export limit.
 */
export async function downloadDriveFile(f: DriveFile, fetchDrive: DriveFetch = driveFetch): Promise<File> {
  const kind = classifyDriveFile(f).kind;
  if (kind === 'reject') throw new Error(`Cannot import ${f.mimeType || 'this file'} from Drive`);
  const id = encodeURIComponent(f.id);
  const exporting = kind === 'export-pdf';
  const res = await fetchDrive(exporting ? `files/${id}/export?mimeType=application%2Fpdf` : `files/${id}?alt=media&supportsAllDrives=true`);
  if (!res.ok) {
    if (exporting && res.status === 403 && (await driveErrorReason(res)) === 'exportSizeLimitExceeded') throw new DriveExportTooLarge();
    throw new Error(`Drive download failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!exporting) return new File([blob], f.name, { type: f.mimeType });
  const name = /\.pdf$/i.test(f.name) ? f.name : `${f.name}.pdf`;
  return new File([blob], name, { type: 'application/pdf' });
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
    picker.setVisible(true);
  });
}
