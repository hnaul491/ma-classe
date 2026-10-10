'use client';

import { useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { formatElapsed, isOvertime } from './timer';
import { BoardIcon, CamIcon, ChatIcon, CamOffIcon, EndIcon, MicIcon, MicOffIcon, PlanBIcon, ShareIcon } from './icons';

const btn = 'flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-blue';

function IconButton({
  label,
  active = false,
  className = '',
  onClick,
  ref,
  children,
}: {
  label: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
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

/** Own component so the 1 s tick re-renders only this pill, not the whole bar. */
function LessonTimer({ startedAt }: { startedAt: string }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const started = Date.parse(startedAt);
  const ms = Number.isNaN(started) ? 0 : now - started;
  const time = formatElapsed(ms);
  return (
    <time
      aria-label={t('bar.elapsed', { time })}
      className={`px-1.5 text-xs [font-variant-numeric:tabular-nums] ${isOvertime(ms) ? 'font-semibold text-pen' : 'text-muted'}`}
    >
      {time}
    </time>
  );
}

export function ControlBar({
  screenSharing,
  boardActive,
  onToggleBoard,
  onToggleShare,
  chatOpen,
  chatUnread,
  onToggleChat,
  chatButtonRef,
  onEnd,
  planBUrl,
  startedAt,
  compact = false,
}: {
  screenSharing: boolean;
  boardActive: boolean;
  onToggleBoard: () => void;
  onToggleShare: () => void;
  chatOpen: boolean;
  /** Messages from the other person not seen yet; shows a dot. */
  chatUnread: number;
  onToggleChat: () => void;
  /** Focus returns here when the chat panel closes. */
  chatButtonRef?: React.Ref<HTMLButtonElement>;
  onEnd: () => void;
  planBUrl: string;
  startedAt: string;
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

  const chatLabel = chatOpen ? t('bar.closeChat') : chatUnread > 0 ? t('bar.chatUnread') : t('bar.chat');
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
      <LessonTimer startedAt={startedAt} />
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
      <IconButton label={chatLabel} active={chatOpen} onClick={onToggleChat} ref={chatButtonRef} className="relative">
        <ChatIcon />
        {chatUnread > 0 && (
          <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-pen ring-2 ring-surface" />
        )}
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
