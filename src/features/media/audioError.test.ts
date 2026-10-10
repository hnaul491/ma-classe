import { describe, expect, it } from 'vitest';
import { DriveHttpError } from '@/features/drive/drive';
import { DriveAuthError, DriveReauthRequired } from '@/features/drive/token';
import { audioLoadProblem } from './audioError';

describe('audioLoadProblem', () => {
  it('no Google token in this browser yet: connect Drive from a click', () => {
    expect(audioLoadProblem(new DriveReauthRequired())).toBe('connect');
  });

  it('403 and 404: the file is not shared with this person', () => {
    expect(audioLoadProblem(new DriveHttpError(403))).toBe('noAccess');
    expect(audioLoadProblem(new DriveHttpError(404))).toBe('noAccess');
  });

  it('anything else is a failure to retry', () => {
    expect(audioLoadProblem(new DriveHttpError(500))).toBe('failed');
    expect(audioLoadProblem(new DriveAuthError('cancelled'))).toBe('failed');
    expect(audioLoadProblem(new TypeError('Failed to fetch'))).toBe('failed');
    expect(audioLoadProblem('boom')).toBe('failed');
  });
});
