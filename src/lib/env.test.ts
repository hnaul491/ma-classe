import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cronSecret, googleConfig, livekitEnv, serviceRoleKey } from './env';

const GOOGLE = ['NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'NEXT_PUBLIC_GOOGLE_API_KEY', 'NEXT_PUBLIC_GOOGLE_APP_ID'];
const ALL = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', ...GOOGLE];

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

  it('googleConfig returns the three Google values when all are set', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_API_KEY', 'AIzaKey');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', '123456789');
    expect(googleConfig()).toEqual({ clientId: 'cid.apps.googleusercontent.com', apiKey: 'AIzaKey', appId: '123456789' });
  });

  it('googleConfig is null (never throws) when any Google value is missing', () => {
    expect(googleConfig()).toBeNull();
    for (const missing of GOOGLE) {
      for (const name of GOOGLE) vi.stubEnv(name, name === missing ? '' : 'x');
      expect(googleConfig()).toBeNull();
    }
  });

  it('googleConfig treats whitespace-only values as missing and trims the rest', () => {
    for (const name of GOOGLE) vi.stubEnv(name, ' x ');
    expect(googleConfig()).toEqual({ clientId: 'x', apiKey: 'x', appId: 'x' });
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', '   ');
    expect(googleConfig()).toBeNull();
  });
});
