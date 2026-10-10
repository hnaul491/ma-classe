import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getMember = vi.fn();
const maybeSingle = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getMember: () => getMember() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}));
vi.mock('@/lib/livekit/token', () => ({ mintToken: async () => 'jwt' }));

import { GET } from './route';

const req = () => ({ nextUrl: new URL('http://localhost/api/token?lesson=L1') }) as unknown as NextRequest;
const teacher = { email: 'prof@example.com', role: 'teacher', display_name: 'Prof' };

describe('GET /api/token', () => {
  beforeEach(() => {
    vi.stubEnv('LIVEKIT_URL', 'wss://x');
    vi.stubEnv('LIVEKIT_API_KEY', 'k');
    vi.stubEnv('LIVEKIT_API_SECRET', 's');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getMember.mockReset();
    maybeSingle.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns a token for a member joining a live lesson', async () => {
    getMember.mockResolvedValue({ user: { email: teacher.email }, member: teacher });
    maybeSingle.mockResolvedValue({ data: { status: 'live' }, error: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'jwt', url: 'wss://x' });
  });

  it('answers 503 (retryable) when membership cannot be checked', async () => {
    getMember.mockRejectedValue(new Error('Could not check membership'));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'join.noAnswer' });
  });

  it('answers 503 instead of "not found" when the lessons query fails', async () => {
    getMember.mockResolvedValue({ user: { email: teacher.email }, member: teacher });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'join.noAnswer' });
  });

  it('still answers 404 for a lesson that does not exist', async () => {
    getMember.mockResolvedValue({ user: { email: teacher.email }, member: teacher });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(req())).status).toBe(404);
  });
});
