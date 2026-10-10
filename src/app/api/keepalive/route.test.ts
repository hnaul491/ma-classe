import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const select = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  adminClient: () => ({ from: () => ({ select }) }),
}));

import { GET } from './route';

const req = (auth?: string) =>
  new Request('http://localhost/api/keepalive', {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;

describe('GET /api/keepalive', () => {
  beforeEach(() => {
    // Only the cron secret: keep-alive must not depend on LiveKit or other secrets.
    vi.stubEnv('LIVEKIT_URL', '');
    vi.stubEnv('LIVEKIT_API_KEY', '');
    vi.stubEnv('LIVEKIT_API_SECRET', '');
    vi.stubEnv('CRON_SECRET', 'test');
    select.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects a missing header', async () => {
    expect((await GET(req())).status).toBe(401);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns ok with the right secret', async () => {
    select.mockResolvedValue({ error: null });
    const res = await GET(req('Bearer test'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 500 when the query fails', async () => {
    select.mockResolvedValue({ error: { message: 'boom' } });
    expect((await GET(req('Bearer test'))).status).toBe(500);
  });
});
