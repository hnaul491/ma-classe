'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { decode, encode, SYNC_TOPIC, type SyncMessage } from './protocol';

export function useSync(onMessage: (msg: SyncMessage, fromIdentity: string) => void) {
  const room = useRoomContext();
  // Always calls the latest onMessage without re-subscribing to the room.
  const handle = useEffectEvent(onMessage);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== SYNC_TOPIC || !participant) return;
      const msg = decode(payload);
      if (msg) handle(msg, participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  return useCallback(
    (msg: SyncMessage, opts?: { to?: string[]; reliable?: boolean }) =>
      room.localParticipant.publishData(encode(msg), {
        reliable: opts?.reliable ?? true,
        topic: SYNC_TOPIC,
        destinationIdentities: opts?.to,
      }),
    [room],
  );
}
