import { describe, expect, it } from 'vitest';
import { mintToken } from './token';

function payload(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

describe('mintToken', () => {
  it('grants join, publish, subscribe and data for exactly one room', async () => {
    const jwt = await mintToken({
      apiKey: 'key',
      apiSecret: 'secret-secret-secret-secret-secret',
      identity: 's@x.fr',
      name: 'Student',
      room: 'lesson-1',
    });
    const p = payload(jwt);
    expect(p.sub).toBe('s@x.fr');
    expect(p.name).toBe('Student');
    expect(p.video).toMatchObject({
      roomJoin: true,
      room: 'lesson-1',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
  });

  it('expires after 4 hours by default', async () => {
    const jwt = await mintToken({
      apiKey: 'key',
      apiSecret: 'secret-secret-secret-secret-secret',
      identity: 'a',
      name: 'A',
      room: 'r',
    });
    const p = payload(jwt);
    expect(p.exp - p.nbf).toBe(4 * 60 * 60);
  });
});
