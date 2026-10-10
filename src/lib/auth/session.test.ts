import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq }) }),
  }),
}));

import { getMember } from './session';

const signedIn = (email: string) => ({ data: { user: { email } }, error: null });

describe('getMember', () => {
  beforeEach(() => {
    getUser.mockReset();
    maybeSingle.mockReset();
    eq.mockClear();
  });

  it('returns nobody when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect(await getMember()).toEqual({ user: null, member: null });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('returns nobody when the auth server rejects the session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('invalid JWT', 403, 'bad_jwt') });
    expect(await getMember()).toEqual({ user: null, member: null });
  });

  it('returns the member when the row exists', async () => {
    getUser.mockResolvedValue(signedIn('Prof@Example.com'));
    maybeSingle.mockResolvedValue({
      data: { email: 'prof@example.com', role: 'teacher', display_name: 'Prof' },
      error: null,
    });
    expect(await getMember()).toEqual({
      user: { email: 'Prof@Example.com' },
      member: { email: 'prof@example.com', role: 'teacher', display_name: 'Prof' },
    });
    expect(eq).toHaveBeenCalledWith('email', 'prof@example.com');
  });

  it('returns member null when there is no member row', async () => {
    getUser.mockResolvedValue(signedIn('stranger@example.com'));
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getMember()).toEqual({ user: { email: 'stranger@example.com' }, member: null });
  });

  it('throws when the members query fails, instead of calling the user a stranger', async () => {
    getUser.mockResolvedValue(signedIn('prof@example.com'));
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    await expect(getMember()).rejects.toThrow('Could not check membership');
  });

  it('throws when the auth server cannot be reached', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) });
    await expect(getMember()).rejects.toThrow('Could not check membership');
  });
});
