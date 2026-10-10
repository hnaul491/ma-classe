import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriveFile } from './classify';

// The download runs after the pick, outside any click: it must never ask for a token interactively.
const tokens = vi.hoisted(() => ({
  getDriveToken: vi.fn(async () => 'interactive'),
  getCachedDriveToken: vi.fn<() => Promise<string>>(),
  clearDriveToken: vi.fn(),
}));
vi.mock('./token', async (importOriginal) => ({ ...(await importOriginal<typeof import('./token')>()), ...tokens }));

const { downloadDriveFile } = await import('./drive');
const { DriveReauthRequired } = await import('./token');

const pdf: DriveFile = { id: 'p1', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('downloadDriveFile (default fetch)', () => {
  it('uses the cached token and never the interactive one', async () => {
    tokens.getCachedDriveToken.mockResolvedValue('cached');
    const fetch = vi.fn(async () => new Response(new Blob(['%PDF']), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const f = await downloadDriveFile(pdf);
    expect(f.name).toBe('a.pdf');
    expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('Authorization')).toBe('Bearer cached');
    expect(tokens.getDriveToken).not.toHaveBeenCalled();
  });

  it('without a valid token, throws DriveReauthRequired before any request (no pop-up)', async () => {
    tokens.getCachedDriveToken.mockRejectedValue(new DriveReauthRequired());
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(downloadDriveFile(pdf)).rejects.toBeInstanceOf(DriveReauthRequired);
    expect(fetch).not.toHaveBeenCalled();
    expect(tokens.getDriveToken).not.toHaveBeenCalled();
  });
});
