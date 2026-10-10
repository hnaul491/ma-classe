import { RoomServiceClient } from 'livekit-server-sdk';
import { serverEnv } from '@/lib/env';

export function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export function roomService(): RoomServiceClient {
  const env = serverEnv();
  return new RoomServiceClient(httpUrl(env.livekitUrl), env.livekitKey, env.livekitSecret);
}

export async function listIdentities(room: string): Promise<string[]> {
  try {
    const participants = await roomService().listParticipants(room);
    return participants.map((p) => p.identity);
  } catch {
    // The room does not exist until someone joins it.
    return [];
  }
}

export async function deleteRoom(room: string): Promise<void> {
  try {
    await roomService().deleteRoom(room);
  } catch {
    // Already gone; nothing to close.
  }
}
