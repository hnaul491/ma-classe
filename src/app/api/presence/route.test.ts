import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getMember = vi.fn();
const select = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getMember: () => getMember() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => ({ select }) }) }));
vi.mock('@/lib/livekit/server', () => ({ listIdentities: async () => ['prof@example.com'] }));

import { GET } from './route';

const req = () => ({ nextUrl: new URL('http://localhost/api/presence?lesson=L1') }) as unknown as NextRequest;
const student = { email: 'eleve@example.com', role: 'student', display_name: 'Élève' };

describe('GET /api/presence', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getMember.mockReset();
    select.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('reports who is in the room', async () => {
    getMember.mockResolvedValue({ user: { email: student.email }, member: student });
    select.mockResolvedValue({ data: [{ email: 'prof@example.com', role: 'teacher' }], error: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacher: true, student: false });
  });

  it('answers 503 when membership cannot be checked', async () => {
    getMember.mockRejectedValue(new Error('Could not check membership'));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'join.noAnswer' });
  });

  it('answers 503 instead of "nobody here" when the members query fails', async () => {
    getMember.mockResolvedValue({ user: { email: student.email }, member: student });
    select.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'join.noAnswer' });
  });
});
