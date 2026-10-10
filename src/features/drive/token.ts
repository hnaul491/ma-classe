import { googleConfig } from '@/lib/env';
import { loadScript } from './script';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Google tokens last one hour; used when the response does not say. */
const DEFAULT_EXPIRES_IN_S = 3600;
/** A token with one minute or less left is treated as expired. */
const EXPIRY_MARGIN_MS = 60_000;

export type DriveToken = { accessToken: string; expiresAt: number };

/** The person closed or blocked the Google pop-up, refused access, or did not grant Drive access. */
export class DriveAuthError extends Error {
  constructor(message = 'Google sign-in was cancelled') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export function tokenValid(t: DriveToken | null, now: number): boolean {
  return t !== null && t.accessToken !== '' && t.expiresAt - now > EXPIRY_MARGIN_MS;
}

/** A GIS token response as a token with an absolute expiry, or a DriveAuthError. */
export function gisTokenResult(r: google.accounts.oauth2.TokenResponse, scope: string, now: number): DriveToken {
  if (r.error || !r.access_token) throw new DriveAuthError(r.error ?? 'No access token');
  // Granular consent: the person can untick Drive and still get a token.
  if (!(r.scope ?? '').split(' ').includes(scope)) throw new DriveAuthError('Drive access was not granted');
  const seconds = Number(r.expires_in);
  const expiresIn = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_EXPIRES_IN_S;
  return { accessToken: r.access_token, expiresAt: now + expiresIn * 1000 };
}

/**
 * An in-memory token: reused while valid, otherwise requested once for all concurrent callers.
 * A failed request is not cached. `clear()` (after a 401) makes the next `get()` ask again.
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
    clear(): void {
      generation += 1;
      token = null;
      pending = null;
    },
  };
}

/** One GIS token request. Rejects with DriveAuthError if the pop-up is closed, blocked or refused. */
async function requestGisToken(): Promise<DriveToken> {
  const config = googleConfig();
  if (!config) throw new Error('Google Drive is not configured');
  await loadScript(GIS_SRC);
  const oauth2 = typeof window === 'undefined' ? undefined : window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services did not load');
  return new Promise<DriveToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        try {
          resolve(gisTokenResult(response, DRIVE_SCOPE, Date.now()));
        } catch (e) {
          reject(e);
        }
      },
      error_callback: (error) => reject(new DriveAuthError(error.type)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

const cache = createTokenCache(requestGisToken);

/** A Google access token for Drive (read-only), from memory or a new GIS request. Browser only. */
export function getDriveToken(): Promise<string> {
  return cache.get();
}

/** Forgets the token, e.g. after Drive answered 401. */
export function clearDriveToken(): void {
  cache.clear();
}
