'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useRef } from 'react';
import { decode, encode, SYNC_TOPIC, type SyncMessage } from './protocol';

export function useSync(onMessage: (msg: SyncMessage, fromIdentity: string) => void) {
  const room = useRoomContext();
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== SYNC_TOPIC || !participant) return;
      const msg = decode(payload);
      if (msg) handlerRef.current(msg, participant.identity);
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
