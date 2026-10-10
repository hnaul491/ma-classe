'use client';

import { useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { useEffect, useState } from 'react';
import { bannerFor } from './connection';

export function StatusBar({ planBUrl }: { planBUrl: string }) {
  const state = useConnectionState();
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
    setSince((prev) => (reconnecting ? (prev ?? Date.now()) : null));
  }, [state]);

  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  const banner = bannerFor(state, since, now);
  if (banner.kind === 'none') return null;

  const text =
    banner.kind === 'connecting'
      ? 'Connecting…'
      : banner.kind === 'reconnecting'
        ? 'Reconnecting… your work is saved.'
        : 'Disconnected.';

  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-hl px-4 py-1.5 text-sm text-hl-ink">
      <span>{text}</span>
      {(banner.kind === 'disconnected' || (banner.kind === 'reconnecting' && banner.suggestPlanB)) && (
        <a href={planBUrl} target="_blank" rel="noopener" className="font-semibold underline">
          Open Plan B
        </a>
      )}
    </div>
  );
}
