import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cronSecret, livekitEnv, serviceRoleKey } from './env';

const ALL = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'];

describe('env', () => {
  beforeEach(() => {
    for (const name of ALL) vi.stubEnv(name, '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('livekitEnv needs only the LiveKit variables', () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://x');
    vi.stubEnv('LIVEKIT_API_KEY', 'k');
    vi.stubEnv('LIVEKIT_API_SECRET', 's');
    expect(livekitEnv()).toEqual({ url: 'wss://x', key: 'k', secret: 's' });
  });

  it('livekitEnv names the missing variable', () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://x');
    vi.stubEnv('LIVEKIT_API_KEY', 'k');
    expect(() => livekitEnv()).toThrow('LIVEKIT_API_SECRET');
  });

  it('serviceRoleKey needs only SUPABASE_SERVICE_ROLE_KEY', () => {
    expect(() => serviceRoleKey()).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'r');
    expect(serviceRoleKey()).toBe('r');
  });

  it('cronSecret needs only CRON_SECRET', () => {
    expect(() => cronSecret()).toThrow('CRON_SECRET');
    vi.stubEnv('CRON_SECRET', 'c');
    expect(cronSecret()).toBe('c');
  });
});
