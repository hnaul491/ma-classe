import { AccessToken } from 'livekit-server-sdk';

export async function mintToken(p: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  room: string;
  ttlSeconds?: number;
}): Promise<string> {
  const at = new AccessToken(p.apiKey, p.apiSecret, {
    identity: p.identity,
    name: p.name,
    ttl: p.ttlSeconds ?? 4 * 60 * 60,
  });
  at.addGrant({ roomJoin: true, room: p.room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}
