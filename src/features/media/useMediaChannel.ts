'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { decodeMedia, encodeMedia, MEDIA_TOPIC, type MediaMessage } from './protocol';

/** The media stage's messages on their own LiveKit topic (reliable: every one is a state change). */
export function useMediaChannel(onMessage: (m: MediaMessage, from: string) => void) {
  const room = useRoomContext();
  const handle = useEffectEvent(onMessage);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== MEDIA_TOPIC || !participant) return;
      const msg = decodeMedia(new TextDecoder().decode(payload));
      if (msg) handle(msg, participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  const send = useCallback(
    async (m: MediaMessage, opts?: { to?: string[] }) => {
      await room.localParticipant.publishData(new TextEncoder().encode(encodeMedia(m)), {
        reliable: true,
        topic: MEDIA_TOPIC,
        destinationIdentities: opts?.to,
      });
    },
    [room],
  );

  return { send };
}
