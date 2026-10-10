'use client';

import { LiveKitRoom } from '@livekit/components-react';
import { DisconnectReason, VideoPresets } from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PreJoin, type JoinChoices } from '@/features/prejoin/PreJoin';
import { ROOM_OPTIONS } from '@/features/room/roomOptions';
import { RoomShell } from '@/features/room/RoomShell';
import type { Member } from '@/lib/lessons/types';
import { FatalError, withRetry } from '@/lib/retry';

async function fetchToken(lessonId: string): Promise<{ token: string; url: string }> {
  const res = await fetch(`/api/token?lesson=${encodeURIComponent(lessonId)}`, { signal: AbortSignal.timeout(10000) });
  const body = (await res.json().catch(() => ({}))) as { token?: string; url?: string; error?: string };
  if (res.ok && body.token && body.url) return { token: body.token, url: body.url };
  if (res.status >= 400 && res.status < 500) throw new FatalError(body.error ?? 'You cannot join this lesson.');
  throw new Error(body.error ?? 'The server did not answer.');
}

export function LessonClient({ lessonId, member, planBUrl }: { lessonId: string; member: Member; planBUrl: string }) {
  const router = useRouter();
  const [conn, setConn] = useState<{ token: string; url: string; choices: JoinChoices } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function join(choices: JoinChoices) {
    setError(null);
    try {
      const { token, url } = await withRetry(() => fetchToken(lessonId), { attempts: 3, baseDelayMs: 500 });
      setConn({ token, url, choices });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
    }
  }

  function onDisconnected(reason?: DisconnectReason) {
    if (reason === DisconnectReason.ROOM_DELETED) router.push('/?ended=1');
    else if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      setConn(null);
      setError('This lesson is open in another tab or window. Close it, then join here.');
    } else if (reason === DisconnectReason.CLIENT_INITIATED) router.push('/');
    else {
      setConn(null);
      setError('You were disconnected. Join again, or use Plan B.');
    }
  }

  if (!conn) {
    return <PreJoin lessonId={lessonId} role={member.role} error={error} planBUrl={planBUrl} onJoin={join} />;
  }

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      options={
        conn.choices.audioOutputId
          ? { ...ROOM_OPTIONS, audioOutput: { deviceId: conn.choices.audioOutputId } }
          : ROOM_OPTIONS
      }
      audio={conn.choices.audioEnabled ? { deviceId: conn.choices.audioDeviceId } : false}
      video={
        conn.choices.videoEnabled
          ? { deviceId: conn.choices.videoDeviceId, resolution: VideoPresets.h540.resolution }
          : false
      }
      onDisconnected={onDisconnected}
    >
      <RoomShell lessonId={lessonId} member={member} planBUrl={planBUrl} />
    </LiveKitRoom>
  );
}
