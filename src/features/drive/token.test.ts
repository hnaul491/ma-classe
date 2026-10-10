import { describe, expect, it, vi } from 'vitest';
import { createTokenCache, DriveAuthError, gisTokenResult, tokenValid } from './token';

describe('tokenValid', () => {
  const now = 1_000_000;
  it('is false without a token', () => {
    expect(tokenValid(null, now)).toBe(false);
  });

  it('needs more than one minute left', () => {
    expect(tokenValid({ accessToken: 't', expiresAt: now + 60_001 }, now)).toBe(true);
    expect(tokenValid({ accessToken: 't', expiresAt: now + 60_000 }, now)).toBe(false);
    expect(tokenValid({ accessToken: 't', expiresAt: now + 59_999 }, now)).toBe(false);
    expect(tokenValid({ accessToken: 't', expiresAt: now - 1 }, now)).toBe(false);
  });

  it('is false for an empty access token', () => {
    expect(tokenValid({ accessToken: '', expiresAt: now + 3_600_000 }, now)).toBe(false);
  });
});

describe('gisTokenResult', () => {
  const scope = 'https://www.googleapis.com/auth/drive.readonly';

  it('turns a GIS token response into a token with an absolute expiry', () => {
    expect(gisTokenResult({ access_token: 'abc', expires_in: 3599, scope: `openid ${scope}` }, scope, 1000)).toEqual({
      accessToken: 'abc',
      expiresAt: 1000 + 3599 * 1000,
    });
  });

  it('accepts expires_in as a string', () => {
    expect(gisTokenResult({ access_token: 'abc', expires_in: '3599', scope }, scope, 0)).toEqual({ accessToken: 'abc', expiresAt: 3_599_000 });
  });

  it('rejects an error response, a missing token, or a token without the Drive scope', () => {
    expect(() => gisTokenResult({ error: 'access_denied' }, scope, 0)).toThrow(DriveAuthError);
    expect(() => gisTokenResult({ expires_in: 3599, scope }, scope, 0)).toThrow(DriveAuthError);
    expect(() => gisTokenResult({ access_token: 'abc', expires_in: 3599, scope: 'openid email' }, scope, 0)).toThrow(DriveAuthError);
  });

  it('assumes one hour when expires_in is missing or bad', () => {
    expect(gisTokenResult({ access_token: 'abc', scope }, scope, 0)).toEqual({ accessToken: 'abc', expiresAt: 3_600_000 });
    expect(gisTokenResult({ access_token: 'abc', expires_in: 'x', scope }, scope, 0)).toEqual({ accessToken: 'abc', expiresAt: 3_600_000 });
  });
});

describe('createTokenCache', () => {
  it('reuses a token while it is valid, and asks again near expiry', async () => {
    let now = 0;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: 'a', expiresAt: 3_600_000 })
      .mockResolvedValueOnce({ accessToken: 'b', expiresAt: 7_200_000 });
    const cache = createTokenCache(request, () => now);
    expect(await cache.get()).toBe('a');
    now = 3_000_000;
    expect(await cache.get()).toBe('a');
    now = 3_540_000; // exactly one minute left: too close
    expect(await cache.get()).toBe('b');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers (one pop-up)', async () => {
    const request = vi.fn().mockResolvedValue({ accessToken: 'a', expiresAt: 3_600_000 });
    const cache = createTokenCache(request, () => 0);
    expect(await Promise.all([cache.get(), cache.get()])).toEqual(['a', 'a']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('clear() forces a new token', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: 'a', expiresAt: 3_600_000 })
      .mockResolvedValueOnce({ accessToken: 'b', expiresAt: 3_600_000 });
    const cache = createTokenCache(request, () => 0);
    expect(await cache.get()).toBe('a');
    cache.clear();
    expect(await cache.get()).toBe('b');
  });

  it('a cancelled request rejects, and the next call asks again', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new DriveAuthError('popup_closed'))
      .mockResolvedValueOnce({ accessToken: 'b', expiresAt: 3_600_000 });
    const cache = createTokenCache(request, () => 0);
    await expect(cache.get()).rejects.toBeInstanceOf(DriveAuthError);
    expect(await cache.get()).toBe('b');
  });

  it('a clear() during a request drops its result', async () => {
    let resolve!: (t: { accessToken: string; expiresAt: number }) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({ accessToken: 'fresh', expiresAt: 3_600_000 });
    const cache = createTokenCache(request, () => 0);
    const first = cache.get();
    cache.clear();
    resolve({ accessToken: 'stale', expiresAt: 3_600_000 });
    expect(await first).toBe('stale');
    expect(await cache.get()).toBe('fresh');
  });
});
