import { RoomServiceClient } from 'livekit-server-sdk';
import { livekitEnv } from '@/lib/env';

export function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

// LiveKit's TwirpError/ServerError carries `status` and `code`; a missing room is 404 / not_found.
export function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: unknown; code?: unknown };
  return e.status === 404 || e.code === 'not_found';
}

export function roomService(): RoomServiceClient {
  const env = livekitEnv();
  return new RoomServiceClient(httpUrl(env.url), env.key, env.secret);
}

export async function listIdentities(room: string): Promise<string[]> {
  try {
    const participants = await roomService().listParticipants(room);
    return participants.map((p) => p.identity);
  } catch (err) {
    // The room does not exist until someone joins it.
    if (!isNotFound(err)) console.error('[livekit] listIdentities failed', err);
    return [];
  }
}

export async function deleteRoom(room: string): Promise<void> {
  try {
    await roomService().deleteRoom(room);
  } catch (err) {
    // Already gone; nothing to close.
    if (!isNotFound(err)) console.error('[livekit] deleteRoom failed', err);
  }
}
