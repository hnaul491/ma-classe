import { googleConfig } from '@/lib/env';
import { loadScript } from './script';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Google tokens last one hour; used when the response does not say. */
const DEFAULT_EXPIRES_IN_S = 3600;
/** A token with one minute or less left is treated as expired. */
const EXPIRY_MARGIN_MS = 60_000;

export type DriveToken = { accessToken: string; expiresAt: number };

/**
 * Why Google access failed:
 * - `cancelled`: the person closed the pop-up;
 * - `popup_blocked`: the browser blocked the pop-up;
 * - `denied`: the person refused access;
 * - `no_scope`: the person signed in but unticked Drive access;
 * - `unknown`: anything else.
 */
export type DriveAuthReason = 'cancelled' | 'popup_blocked' | 'denied' | 'no_scope' | 'unknown';

export class DriveAuthError extends Error {
  readonly reason: DriveAuthReason;
  constructor(reason: DriveAuthReason, message = `Google Drive access failed (${reason})`) {
    super(message);
    this.name = 'DriveAuthError';
    this.reason = reason;
  }
}

/**
 * Drive needs a new token, which needs a pop-up, which browsers block without a click: the token
 * expired or was revoked (Drive answered 401), or there is none for a request made outside a click.
 * Show a "Reconnect Google Drive" button and retry from its click.
 */
export class DriveReauthRequired extends Error {
  constructor() {
    super('Google Drive needs to be reconnected');
    this.name = 'DriveReauthRequired';
  }
}

export function tokenValid(t: DriveToken | null, now: number): boolean {
  return t !== null && t.accessToken !== '' && t.expiresAt - now > EXPIRY_MARGIN_MS;
}

/** A GIS pop-up error type as a reason. */
export function popupErrorReason(type: string): DriveAuthReason {
  if (type === 'popup_closed') return 'cancelled';
  if (type === 'popup_failed_to_open') return 'popup_blocked';
  return 'unknown';
}

/** A GIS token response as a token with an absolute expiry, or a DriveAuthError. */
export function gisTokenResult(r: google.accounts.oauth2.TokenResponse, scope: string, now: number): DriveToken {
  if (r.error) throw new DriveAuthError(r.error === 'access_denied' ? 'denied' : 'unknown', `Google refused the token: ${r.error}`);
  if (!r.access_token) throw new DriveAuthError('unknown', 'Google sent no access token');
  // Granular consent: the person can untick Drive and still get a token.
  if (!(r.scope ?? '').split(' ').includes(scope)) throw new DriveAuthError('no_scope', 'Drive access was not granted');
  const seconds = Number(r.expires_in);
  const expiresIn = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_EXPIRES_IN_S;
  return { accessToken: r.access_token, expiresAt: now + expiresIn * 1000 };
}

/**
 * An in-memory token: reused while valid, otherwise requested once for all concurrent callers.
 * `request` is called synchronously from `get()`, so a pop-up keeps the caller's click.
 * A failed request is not cached. `clear()` (after a 401) makes the next `get()` ask again.
 * `cached()` never asks: the valid token, the request already in flight, or DriveReauthRequired.
 */
export function createTokenCache(request: () => Promise<DriveToken>, now: () => number = Date.now) {
  let token: DriveToken | null = null;
  let pending: Promise<string> | null = null;
  let generation = 0;

  return {
    get(): Promise<string> {
      if (tokenValid(token, now())) return Promise.resolve(token!.accessToken);
      if (pending) return pending;
      const gen = generation;
      const p = request().then(
        (t) => {
          if (gen === generation) {
            token = t;
            pending = null;
          }
          return t.accessToken;
        },
        (e: unknown) => {
          if (gen === generation) pending = null;
          throw e;
        },
      );
      pending = p;
      return p;
    },
    cached(): Promise<string> {
      if (tokenValid(token, now())) return Promise.resolve(token!.accessToken);
      if (pending) return pending;
      return Promise.reject(new DriveReauthRequired());
    },
    clear(): void {
      generation += 1;
      token = null;
      pending = null;
    },
  };
}

/** What the app uses of `google.accounts.oauth2` (injectable for tests). */
export type OAuth2Api = Pick<typeof google.accounts.oauth2, 'initTokenClient'>;

export type GisAuthDeps = {
  loadOAuth2: () => Promise<OAuth2Api>;
  clientId: () => string | null;
  now?: () => number;
};

/**
 * One GIS token client per page, created by `preload()` (or by the first request). Once it exists,
 * `request()` calls `requestAccessToken` synchronously, inside the person's click, so the pop-up is
 * not blocked. Before that, it loads GIS first and then asks (the pop-up may then be blocked).
 */
export function createGisAuth(deps: GisAuthDeps) {
  const now = deps.now ?? Date.now;
  let client: google.accounts.oauth2.TokenClient | null = null;
  let loading: Promise<google.accounts.oauth2.TokenClient> | null = null;
  let waiting: { resolve: (t: DriveToken) => void; reject: (e: unknown) => void } | null = null;

  const settle = (fn: (w: NonNullable<typeof waiting>) => void) => {
    const w = waiting;
    waiting = null;
    if (w) fn(w);
  };

  function ensureClient(): Promise<google.accounts.oauth2.TokenClient> {
    if (client) return Promise.resolve(client);
    loading ??= (async () => {
      const clientId = deps.clientId();
      if (!clientId) throw new Error('Google Drive is not configured');
      const oauth2 = await deps.loadOAuth2();
      client = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) =>
          settle((w) => {
            try {
              w.resolve(gisTokenResult(response, DRIVE_SCOPE, now()));
            } catch (e) {
              w.reject(e);
            }
          }),
        error_callback: (error) => settle((w) => w.reject(new DriveAuthError(popupErrorReason(error.type)))),
      });
      return client;
    })().catch((e: unknown) => {
      loading = null;
      throw e;
    });
    return loading;
  }

  function ask(c: google.accounts.oauth2.TokenClient): Promise<DriveToken> {
    return new Promise<DriveToken>((resolve, reject) => {
      settle((w) => w.reject(new DriveAuthError('unknown', 'Replaced by a newer Google token request')));
      waiting = { resolve, reject };
      try {
        c.requestAccessToken({ prompt: '' });
      } catch (e) {
        settle((w) => w.reject(e));
      }
    });
  }

  return {
    /** Loads GIS and creates the token client. True when ready; never rejects. */
    preload(): Promise<boolean> {
      return ensureClient().then(
        () => true,
        () => false,
      );
    },
    request(): Promise<DriveToken> {
      return client ? ask(client) : ensureClient().then(ask);
    },
  };
}

async function loadOAuth2(): Promise<OAuth2Api> {
  await loadScript(GIS_SRC);
  const oauth2 = typeof window === 'undefined' ? undefined : window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services did not load');
  return oauth2;
}

const gis = createGisAuth({ loadOAuth2, clientId: () => googleConfig()?.clientId ?? null });
const cache = createTokenCache(gis.request);

/**
 * Loads Google sign-in ahead of time, so the first Drive click opens its pop-up right away instead of
 * after a script load (which browsers block). Call it when a Drive button or menu mounts. Never rejects.
 */
export function preloadDriveAuth(): Promise<boolean> {
  return gis.preload();
}

/** A Google access token for Drive (read-only), from memory or a new GIS request. Call it from a click. */
export function getDriveToken(): Promise<string> {
  return cache.get();
}

/**
 * The token in memory, without ever opening a pop-up: for requests outside a click (the download
 * after a pick). Rejects with DriveReauthRequired when there is none or it is about to expire.
 */
export function getCachedDriveToken(): Promise<string> {
  return cache.cached();
}

/** Forgets the token, e.g. after Drive answered 401. */
export function clearDriveToken(): void {
  cache.clear();
}
