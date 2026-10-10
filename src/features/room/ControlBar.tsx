'use client';

import { useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { BoardIcon, CamIcon, CamOffIcon, EndIcon, MicIcon, MicOffIcon, PlanBIcon, ShareIcon } from './icons';

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
  screenSharing,
  boardActive,
  onToggleBoard,
  onToggleShare,
  onEnd,
  planBUrl,
  compact = false,
}: {
  screenSharing: boolean;
  boardActive: boolean;
  onToggleBoard: () => void;
  onToggleShare: () => void;
  onEnd: () => void;
  planBUrl: string;
  compact?: boolean;
}) {
  const t = useT();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    if (!confirmEnd) return;
    const id = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(id);
  }, [confirmEnd]);

  const endLabel = confirmEnd ? t('bar.confirmEnd') : t('bar.end');
  const onEndClick = () => {
    if (!confirmEnd) return setConfirmEnd(true);
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
      <IconButton label={mic.enabled ? t('bar.mute') : t('bar.unmute')} onClick={() => void mic.toggle()}>
        {mic.enabled ? <MicIcon /> : <MicOffIcon />}
      </IconButton>
      <IconButton label={cam.enabled ? t('bar.camOff') : t('bar.camOn')} onClick={() => void cam.toggle()}>
        {cam.enabled ? <CamIcon /> : <CamOffIcon />}
      </IconButton>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <IconButton label={boardActive ? t('bar.closeBoard') : t('bar.board')} active={boardActive} onClick={onToggleBoard}>
        <BoardIcon />
      </IconButton>
      <IconButton label={screenSharing ? t('bar.stopShare') : t('bar.share')} active={screenSharing} onClick={onToggleShare}>
        <ShareIcon />
      </IconButton>
      {!compact && <span className="flex-1" />}
      <a
        href={planBUrl}
        target="_blank"
        rel="noopener"
        title={t('bar.planB')}
        aria-label={t('bar.planB')}
        className={`${btn} bg-hl text-hl-ink`}
      >
        <PlanBIcon />
      </a>
      <button
        type="button"
        title={endLabel}
        aria-label={endLabel}
        onClick={onEndClick}
        className={`flex h-9 items-center justify-center gap-1.5 rounded-full bg-pen px-3 text-surface transition-colors hover:bg-[color-mix(in_srgb,var(--pen)_86%,var(--ink))] ${confirmEnd ? 'ring-2 ring-pen ring-offset-2 ring-offset-surface' : ''}`}
      >
        <EndIcon />
        {confirmEnd && <span className="text-xs font-semibold">{t('bar.clickAgain')}</span>}
      </button>
    </div>
  );
}
