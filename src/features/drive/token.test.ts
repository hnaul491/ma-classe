import { describe, expect, it, vi } from 'vitest';
import { createGisAuth, createTokenCache, DRIVE_SCOPE, DriveAuthError, DriveReauthRequired, gisTokenResult, type OAuth2Api, tokenValid } from './token';

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

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DriveAuthError ? e.reason : 'not a DriveAuthError';
  }
  return 'no error';
};

describe('gisTokenResult', () => {
  const scope = DRIVE_SCOPE;

  it('turns a GIS token response into a token with an absolute expiry', () => {
    expect(gisTokenResult({ access_token: 'abc', expires_in: 3599, scope: `openid ${scope}` }, scope, 1000)).toEqual({
      accessToken: 'abc',
      expiresAt: 1000 + 3599 * 1000,
    });
  });

  it('accepts expires_in as a string', () => {
    expect(gisTokenResult({ access_token: 'abc', expires_in: '3599', scope }, scope, 0)).toEqual({ accessToken: 'abc', expiresAt: 3_599_000 });
  });

  it('keeps why it failed: refused, no token, or no Drive scope', () => {
    expect(reasonOf(() => gisTokenResult({ error: 'access_denied' }, scope, 0))).toBe('denied');
    expect(reasonOf(() => gisTokenResult({ error: 'invalid_request' }, scope, 0))).toBe('unknown');
    expect(reasonOf(() => gisTokenResult({ expires_in: 3599, scope }, scope, 0))).toBe('unknown');
    expect(reasonOf(() => gisTokenResult({ access_token: 'abc', expires_in: 3599, scope: 'openid email' }, scope, 0))).toBe('no_scope');
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

  it('asks synchronously, inside the caller’s click', () => {
    const request = vi.fn(() => new Promise<never>(() => {}));
    const cache = createTokenCache(request, () => 0);
    void cache.get();
    expect(request).toHaveBeenCalledTimes(1);
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
      .mockRejectedValueOnce(new DriveAuthError('cancelled'))
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

describe('createTokenCache cached() (no pop-up, for downloads after the pick)', () => {
  it('rejects with DriveReauthRequired without asking when there is no token', async () => {
    const request = vi.fn();
    const cache = createTokenCache(request, () => 0);
    await expect(cache.cached()).rejects.toBeInstanceOf(DriveReauthRequired);
    expect(request).not.toHaveBeenCalled();
  });

  it('returns a valid token, and rejects without asking once it is within the expiry margin', async () => {
    let now = 0;
    const request = vi.fn().mockResolvedValue({ accessToken: 'a', expiresAt: 3_600_000 });
    const cache = createTokenCache(request, () => now);
    expect(await cache.get()).toBe('a');
    expect(await cache.cached()).toBe('a');
    now = 3_540_000; // exactly one minute left: get() would open a pop-up here
    await expect(cache.cached()).rejects.toBeInstanceOf(DriveReauthRequired);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects without asking after clear() (Drive answered 401)', async () => {
    const request = vi.fn().mockResolvedValue({ accessToken: 'a', expiresAt: 3_600_000 });
    const cache = createTokenCache(request, () => 0);
    await cache.get();
    cache.clear();
    await expect(cache.cached()).rejects.toBeInstanceOf(DriveReauthRequired);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('joins a request already started from a click instead of starting one', async () => {
    let resolve!: (t: { accessToken: string; expiresAt: number }) => void;
    const request = vi.fn(() => new Promise<{ accessToken: string; expiresAt: number }>((r) => (resolve = r)));
    const cache = createTokenCache(request, () => 0);
    void cache.get();
    const joined = cache.cached();
    resolve({ accessToken: 'a', expiresAt: 3_600_000 });
    expect(await joined).toBe('a');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

/** A fake `google.accounts.oauth2` that records the config and lets the test answer. */
function fakeOAuth2() {
  const requestAccessToken = vi.fn();
  let config: google.accounts.oauth2.TokenClientConfig | null = null;
  const initTokenClient = vi.fn((c: google.accounts.oauth2.TokenClientConfig) => {
    config = c;
    return { requestAccessToken };
  });
  const api: OAuth2Api = { initTokenClient };
  return {
    api,
    initTokenClient,
    requestAccessToken,
    answer: (r: google.accounts.oauth2.TokenResponse) => config!.callback(r),
    fail: (type: string) => config!.error_callback!({ type }),
    config: () => config,
  };
}

function setup(clientId: string | null = 'cid') {
  const fake = fakeOAuth2();
  const loadOAuth2 = vi.fn(async () => fake.api);
  const auth = createGisAuth({ loadOAuth2, clientId: () => clientId, now: () => 1000 });
  return { fake, loadOAuth2, auth };
}

describe('createGisAuth', () => {
  it('preload loads GIS and creates one token client with the client id and the Drive scope', async () => {
    const { fake, loadOAuth2, auth } = setup();
    expect(await auth.preload()).toBe(true);
    expect(await auth.preload()).toBe(true);
    expect(loadOAuth2).toHaveBeenCalledTimes(1);
    expect(fake.initTokenClient).toHaveBeenCalledTimes(1);
    expect(fake.config()).toMatchObject({ client_id: 'cid', scope: DRIVE_SCOPE });
  });

  it('once preloaded, asks for the token synchronously with prompt "" (keeps the click’s pop-up permission)', async () => {
    const { fake, auth } = setup();
    await auth.preload();
    const p = auth.request();
    expect(fake.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(fake.requestAccessToken).toHaveBeenCalledWith({ prompt: '' });
    fake.answer({ access_token: 'tok', expires_in: 3600, scope: DRIVE_SCOPE });
    expect(await p).toEqual({ accessToken: 'tok', expiresAt: 1000 + 3_600_000 });
  });

  it('without preload, loads first and then asks; the client is still created once', async () => {
    const { fake, auth } = setup();
    const p1 = auth.request();
    expect(fake.requestAccessToken).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fake.requestAccessToken).toHaveBeenCalledTimes(1));
    fake.answer({ access_token: 'a', expires_in: 3600, scope: DRIVE_SCOPE });
    expect((await p1).accessToken).toBe('a');
    const p2 = auth.request();
    expect(fake.requestAccessToken).toHaveBeenCalledTimes(2);
    fake.answer({ access_token: 'b', expires_in: 3600, scope: DRIVE_SCOPE });
    expect((await p2).accessToken).toBe('b');
    expect(fake.initTokenClient).toHaveBeenCalledTimes(1);
  });

  it('maps pop-up errors to a reason', async () => {
    const { fake, auth } = setup();
    await auth.preload();
    const cases: [string, string][] = [
      ['popup_closed', 'cancelled'],
      ['popup_failed_to_open', 'popup_blocked'],
      ['unknown', 'unknown'],
      ['something_new', 'unknown'],
    ];
    for (const [type, reason] of cases) {
      const p = auth.request();
      fake.fail(type);
      await expect(p).rejects.toMatchObject({ name: 'DriveAuthError', reason });
    }
  });

  it('maps a refused or partial grant to a reason', async () => {
    const { fake, auth } = setup();
    await auth.preload();
    const denied = auth.request();
    fake.answer({ error: 'access_denied' });
    await expect(denied).rejects.toMatchObject({ reason: 'denied' });
    const noScope = auth.request();
    fake.answer({ access_token: 'a', expires_in: 3600, scope: 'openid email' });
    await expect(noScope).rejects.toMatchObject({ reason: 'no_scope' });
  });

  it('a new request settles the one it replaces instead of leaving it hanging', async () => {
    const { fake, auth } = setup();
    await auth.preload();
    const first = auth.request();
    const second = auth.request();
    await expect(first).rejects.toBeInstanceOf(DriveAuthError);
    fake.answer({ access_token: 'b', expires_in: 3600, scope: DRIVE_SCOPE });
    expect((await second).accessToken).toBe('b');
  });

  it('preload is false without Google config, and a failed load is retried later', async () => {
    expect(await setup(null).auth.preload()).toBe(false);
    const fake = fakeOAuth2();
    const loadOAuth2 = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fake.api);
    const auth = createGisAuth({ loadOAuth2, clientId: () => 'cid', now: () => 0 });
    expect(await auth.preload()).toBe(false);
    expect(await auth.preload()).toBe(true);
    expect(loadOAuth2).toHaveBeenCalledTimes(2);
  });

  it('request rejects (not hangs) when GIS cannot load', async () => {
    const auth = createGisAuth({ loadOAuth2: () => Promise.reject(new Error('offline')), clientId: () => 'cid', now: () => 0 });
    await expect(auth.request()).rejects.toThrow('offline');
  });
});
