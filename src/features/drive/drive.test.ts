import { describe, expect, it, vi } from 'vitest';
import type { DriveFile } from './classify';
import {
  createDriveFetch,
  downloadDriveFile,
  DRIVE_API,
  DriveExportTooLarge,
  driveErrorKey,
  DriveHttpError,
  driveErrorReason,
  DriveReauthRequired,
  pickedFile,
  pickerOutcome,
} from './drive';
import { DriveAuthError } from './token';

function deps(responses: Response[], tokens = ['t1', 't2']) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    return r;
  });
  const getToken = vi.fn(async () => {
    const t = tokens.shift();
    if (!t) throw new Error('no more tokens');
    return t;
  });
  const clearToken = vi.fn();
  return { fetch, getToken, clearToken };
}

const auth = (init: RequestInit | undefined) => new Headers(init?.headers).get('Authorization');

describe('createDriveFetch', () => {
  it('calls the Drive v3 API with a Bearer token', async () => {
    const d = deps([new Response('ok')]);
    const res = await createDriveFetch(d)('files/abc?alt=media', { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(200);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toBe(`${DRIVE_API}files/abc?alt=media`);
    expect(auth(init)).toBe('Bearer t1');
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
    expect(d.clearToken).not.toHaveBeenCalled();
  });

  it('never sends the token outside the Drive API, whatever the path', async () => {
    const d = deps([new Response('ok'), new Response('ok')]);
    await createDriveFetch(d)('/files/abc');
    await createDriveFetch(d)('https://evil.example/x');
    expect(d.fetch.mock.calls[0][0]).toBe(`${DRIVE_API}files/abc`);
    expect(d.fetch.mock.calls[1][0]).toBe('https://www.googleapis.com/drive/v3/https://evil.example/x');
  });

  it('on a 401, clears the token and throws DriveReauthRequired (no pop-up without a click)', async () => {
    const d = deps([new Response('', { status: 401 })]);
    await expect(createDriveFetch(d)('files/abc')).rejects.toBeInstanceOf(DriveReauthRequired);
    expect(d.clearToken).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.getToken).toHaveBeenCalledTimes(1);
  });

  it('after a reconnect (a later call, from a click) it uses the fresh token', async () => {
    const d = deps([new Response('', { status: 401 }), new Response('ok')]);
    const fetchDrive = createDriveFetch(d);
    await expect(fetchDrive('files/abc')).rejects.toMatchObject({ name: 'DriveReauthRequired' });
    const res = await fetchDrive('files/abc');
    expect(res.status).toBe(200);
    expect(auth(d.fetch.mock.calls[0][1])).toBe('Bearer t1');
    expect(auth(d.fetch.mock.calls[1][1])).toBe('Bearer t2');
  });

  it('downloadDriveFile passes DriveReauthRequired through', async () => {
    const d = deps([new Response('', { status: 401 })]);
    const f: DriveFile = { id: 'p1', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1 };
    await expect(downloadDriveFile(f, createDriveFetch(d))).rejects.toBeInstanceOf(DriveReauthRequired);
  });

  it('does not retry other errors', async () => {
    const d = deps([new Response('', { status: 403 })]);
    const res = await createDriveFetch(d)('files/abc');
    expect(res.status).toBe(403);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.clearToken).not.toHaveBeenCalled();
  });
});

describe('driveErrorKey', () => {
  it('maps a failed import to its toast', () => {
    expect(driveErrorKey(new DriveAuthError('cancelled'))).toBe('drive.authCancelled');
    expect(driveErrorKey(new DriveAuthError('no_scope'))).toBe('drive.authCancelled');
    expect(driveErrorKey(new DriveExportTooLarge())).toBe('drive.exportTooLarge');
    expect(driveErrorKey(new Error('Drive download failed (500)'))).toBe('drive.failed');
    expect(driveErrorKey(new DriveHttpError(404))).toBe('drive.failed');
    expect(driveErrorKey('boom')).toBe('drive.failed');
  });
});

describe('driveErrorReason', () => {
  it('reads the reason of a Drive error body', async () => {
    const body = { error: { code: 403, message: 'This file is too large to be exported.', errors: [{ domain: 'global', reason: 'exportSizeLimitExceeded' }] } };
    expect(await driveErrorReason(new Response(JSON.stringify(body), { status: 403 }))).toBe('exportSizeLimitExceeded');
  });

  it('is null for a body that is not a Drive error', async () => {
    expect(await driveErrorReason(new Response('nope', { status: 500 }))).toBeNull();
    expect(await driveErrorReason(new Response('{"error":{}}', { status: 500 }))).toBeNull();
  });
});

describe('downloadDriveFile', () => {
  const pdf: DriveFile = { id: 'p 1', name: 'Leçon.pdf', mimeType: 'application/pdf', sizeBytes: 100 };
  const slides: DriveFile = { id: 's1', name: 'Unité 3', mimeType: 'application/vnd.google-apps.presentation', sizeBytes: null };

  it('downloads a file with alt=media, keeping its name and type', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const f = await downloadDriveFile(pdf, fetch);
    expect(fetch.mock.calls[0]).toEqual(['files/p%201?alt=media&supportsAllDrives=true']);
    expect(f.name).toBe('Leçon.pdf');
    expect(f.type).toBe('application/pdf');
    expect(f.size).toBe(3);
  });

  it('exports Docs and Slides to a PDF named after the file', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1])));
    const f = await downloadDriveFile(slides, fetch);
    expect(fetch.mock.calls[0]).toEqual(['files/s1/export?mimeType=application%2Fpdf']);
    expect(f.name).toBe('Unité 3.pdf');
    expect(f.type).toBe('application/pdf');
  });

  it('does not double the .pdf extension', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1])));
    const f = await downloadDriveFile({ ...slides, name: 'notes.PDF' }, fetch);
    expect(f.name).toBe('notes.PDF');
  });

  it('throws DriveExportTooLarge when the export is over the 10 MB limit', async () => {
    const body = { error: { code: 403, errors: [{ reason: 'exportSizeLimitExceeded' }] } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 403 }));
    await expect(downloadDriveFile(slides, fetch)).rejects.toBeInstanceOf(DriveExportTooLarge);
  });

  it('throws a DriveHttpError with the status for other failures', async () => {
    for (const status of [403, 404, 500]) {
      const fetch = vi.fn(async () => new Response('{}', { status }));
      const err = await downloadDriveFile(pdf, fetch).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DriveHttpError);
      expect(err).not.toBeInstanceOf(DriveExportTooLarge);
      expect((err as DriveHttpError).status).toBe(status);
    }
  });

  it('a 403 on an export that is not the size limit is a DriveHttpError too', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"errors":[{"reason":"forbidden"}]}}', { status: 403 }));
    const err = await downloadDriveFile(slides, fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriveHttpError);
    expect((err as DriveHttpError).status).toBe(403);
  });

  it('downloads audio as is, for the media stage', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    const f = await downloadDriveFile({ id: 'a1', name: 'dialogue.mp3', mimeType: 'audio/mpeg', sizeBytes: null }, fetch);
    expect(fetch.mock.calls[0]).toEqual(['files/a1?alt=media&supportsAllDrives=true']);
    expect(f.type).toBe('audio/mpeg');
  });

  it('refuses a file it cannot handle, without fetching', async () => {
    const fetch = vi.fn(async () => new Response(''));
    await expect(downloadDriveFile({ ...pdf, mimeType: 'video/mp4' }, fetch)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('pickedFile', () => {
  it('reads id, name, mime and the size string from a Picker document', () => {
    expect(pickedFile({ id: 'a', name: 'n.pdf', mimeType: 'application/pdf', sizeBytes: '2048', url: 'x' })).toEqual({
      id: 'a',
      name: 'n.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
  });

  it('uses null for a missing or bad size (Google-native files)', () => {
    expect(pickedFile({ id: 'a', name: 'Doc', mimeType: 'application/vnd.google-apps.document' })?.sizeBytes).toBeNull();
    expect(pickedFile({ id: 'a', name: 'Doc', mimeType: 'x', sizeBytes: 'abc' })?.sizeBytes).toBeNull();
    expect(pickedFile({ id: 'a', name: 'Doc', mimeType: 'x', sizeBytes: '-5' })?.sizeBytes).toBeNull();
    expect(pickedFile({ id: 'a', name: 'Doc', mimeType: 'x', sizeBytes: 12 })?.sizeBytes).toBe(12);
  });

  it('is null without an id', () => {
    expect(pickedFile(undefined)).toBeNull();
    expect(pickedFile({ name: 'n' })).toBeNull();
    expect(pickedFile({ id: '', name: 'n', mimeType: 'x' })).toBeNull();
  });

  it('defaults a missing name and mime to empty strings', () => {
    expect(pickedFile({ id: 'a' })).toEqual({ id: 'a', name: '', mimeType: '', sizeBytes: null });
  });
});

describe('pickerOutcome', () => {
  const Action = { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' };
  const doc = { id: 'a', name: 'n.pdf', mimeType: 'application/pdf', sizeBytes: '10' };

  it('keeps waiting while the Picker only reports it has loaded', () => {
    expect(pickerOutcome({ action: 'loaded' }, Action)).toEqual({ done: false });
  });

  it('settles with the picked file', () => {
    expect(pickerOutcome({ action: 'picked', docs: [doc] }, Action)).toEqual({
      done: true,
      file: { id: 'a', name: 'n.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    });
  });

  it('settles with null on cancel, a pick without documents, or any other action (never hangs)', () => {
    expect(pickerOutcome({ action: 'cancel' }, Action)).toEqual({ done: true, file: null });
    expect(pickerOutcome({ action: 'picked', docs: [] }, Action)).toEqual({ done: true, file: null });
    expect(pickerOutcome({ action: 'picked' }, Action)).toEqual({ done: true, file: null });
    expect(pickerOutcome({ action: 'error' }, Action)).toEqual({ done: true, file: null });
  });
});
