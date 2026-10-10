'use client';

import { useConnectionState, useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { bannerFor } from './connection';

const isReconnecting = (s: ConnectionState) =>
  s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting;

/**
 * When the current reconnect began, or null. RoomShell owns it so the 30 s Plan B
 * timer survives entering or leaving fullscreen, which remounts StatusBar.
 */
export function useReconnectingSince(): number | null {
  const room = useRoomContext();
  const [since, setSince] = useState<number | null>(() => (isReconnecting(room.state) ? Date.now() : null));

  useEffect(() => {
    const onChange = (state: ConnectionState) =>
      setSince((prev) => (isReconnecting(state) ? (prev ?? Date.now()) : null));
    room.on(RoomEvent.ConnectionStateChanged, onChange);
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onChange);
    };
  }, [room]);

  return since;
}

export function StatusBar({ planBUrl, since, overlay = false }: { planBUrl: string; since: number | null; overlay?: boolean }) {
  const t = useT();
  const state = useConnectionState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  const banner = bannerFor(state, since, now);
  if (banner.kind === 'none') return null;

  const text =
    banner.kind === 'connecting'
      ? t('status.connecting')
      : banner.kind === 'reconnecting'
        ? t('status.reconnecting')
        : t('status.disconnected');

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-3 bg-hl px-4 py-1.5 text-sm text-hl-ink ${overlay ? 'absolute inset-x-0 top-0 z-30 shadow' : ''}`}
    >
      <span>{text}</span>
      {(banner.kind === 'disconnected' || (banner.kind === 'reconnecting' && banner.suggestPlanB)) && (
        <a href={planBUrl} target="_blank" rel="noopener" className="font-semibold underline">
          {t('common.openPlanB')}
        </a>
      )}
    </div>
  );
}
