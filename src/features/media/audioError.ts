import { DriveHttpError } from '@/features/drive/drive';
import { DriveReauthRequired } from '@/features/drive/token';

/**
 * Why this browser could not download the Drive audio:
 * - `connect`: no Google token here yet (the other person picked it); connect from a click;
 * - `noAccess`: Drive answered 403 or 404, so the file is not shared with this account;
 * - `failed`: anything else (network, server); try again.
 */
export function audioLoadProblem(e: unknown): 'connect' | 'noAccess' | 'failed' {
  if (e instanceof DriveReauthRequired) return 'connect';
  if (e instanceof DriveHttpError && (e.status === 403 || e.status === 404)) return 'noAccess';
  return 'failed';
}
