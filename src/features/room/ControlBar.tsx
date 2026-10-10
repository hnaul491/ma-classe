'use client';

import { useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useState } from 'react';
import type { Role } from '@/lib/lessons/types';
import { CamIcon, CamOffIcon, EndIcon, MicIcon, MicOffIcon, PlanBIcon, ShareIcon } from './icons';

const btn = 'flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-blue';

function IconButton({
  label,
  active = false,
  className = '',
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`${btn} ${active ? 'bg-blue text-surface' : 'bg-surface-2 text-ink hover:bg-line'} ${className}`}
    >
      {children}
    </button>
  );
}

export function ControlBar({
  role,
  screenSharing,
  onToggleShare,
  onEnd,
  planBUrl,
  compact = false,
}: {
  role: Role;
  screenSharing: boolean;
  onToggleShare: () => void;
  onEnd: () => void;
  planBUrl: string;
  compact?: boolean;
}) {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    if (!confirmEnd) return;
    const id = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(id);
  }, [confirmEnd]);

  const endLabel = role === 'teacher' ? (confirmEnd ? 'Click again to end' : 'End lesson') : 'Leave';
  const onEndClick = () => {
    if (role === 'teacher' && !confirmEnd) return setConfirmEnd(true);
    onEnd();
  };

  return (
    <div
      className={
        compact
          ? 'flex items-center gap-1 rounded-full border border-line bg-surface/95 px-2 py-1 shadow-lg'
          : 'flex items-center gap-1.5 border-t border-line bg-surface px-3 py-2'
      }
    >
      <IconButton label={mic.enabled ? 'Mute microphone' : 'Unmute microphone'} onClick={() => void mic.toggle()}>
        {mic.enabled ? <MicIcon /> : <MicOffIcon />}
      </IconButton>
      <IconButton label={cam.enabled ? 'Turn camera off' : 'Turn camera on'} onClick={() => void cam.toggle()}>
        {cam.enabled ? <CamIcon /> : <CamOffIcon />}
      </IconButton>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <IconButton label={screenSharing ? 'Stop sharing' : 'Share screen'} active={screenSharing} onClick={onToggleShare}>
        <ShareIcon />
      </IconButton>
      {!compact && <span className="flex-1" />}
      {!compact && (
        <a
          href={planBUrl}
          target="_blank"
          rel="noopener"
          title="Plan B: open Google Meet"
          aria-label="Plan B: open Google Meet"
          className={`${btn} bg-hl text-hl-ink`}
        >
          <PlanBIcon />
        </a>
      )}
      <button
        type="button"
        title={endLabel}
        aria-label={endLabel}
        onClick={onEndClick}
        className={`flex h-9 items-center justify-center gap-1.5 rounded-full bg-pen px-3 text-surface ${confirmEnd ? 'ring-2 ring-pen ring-offset-2 ring-offset-surface' : ''}`}
      >
        <EndIcon />
        {confirmEnd && <span className="text-xs font-semibold">Click again</span>}
      </button>
    </div>
  );
}
