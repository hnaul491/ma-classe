'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { BOARD_TOPIC, decodeBoard, encodeBoard, fitsInPacket, SCENE_TOPIC, type BoardMessage } from './protocol';

export function useBoardChannel(onMessage: (m: BoardMessage, from: string) => void) {
  const room = useRoomContext();
  const handle = useEffectEvent(onMessage);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== BOARD_TOPIC || !participant) return;
      const msg = decodeBoard(new TextDecoder().decode(payload));
      if (msg) handle(msg, participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    room.registerTextStreamHandler(SCENE_TOPIC, async (reader, info) => {
      const msg = decodeBoard(await reader.readAll());
      if (msg) handle(msg, info.identity);
    });
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.unregisterTextStreamHandler(SCENE_TOPIC);
    };
  }, [room]);

  const send = useCallback(
    async (m: BoardMessage, opts?: { to?: string[]; lossy?: boolean }) => {
      const json = encodeBoard(m);
      if (fitsInPacket(json)) {
        await room.localParticipant.publishData(new TextEncoder().encode(json), {
          reliable: !opts?.lossy,
          topic: BOARD_TOPIC,
          destinationIdentities: opts?.to,
        });
      } else {
        await room.localParticipant.sendText(json, { topic: SCENE_TOPIC, destinationIdentities: opts?.to });
      }
    },
    [room],
  );

  return { send };
}
