'use client';

import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useT } from '@/lib/i18n/client';

export function ScreenView({ onStop }: { onStop: () => void }) {
  const t = useT();
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const ref = tracks[tracks.length - 1];
  if (!ref) return <div className="flex h-full items-center justify-center text-muted">{t('screen.none')}</div>;

  if (ref.participant.isLocal) {
    const settings = ref.publication.track?.mediaStreamTrack.getSettings() as
      | (MediaTrackSettings & { displaySurface?: string })
      | undefined;
    const wholeScreen = settings?.displaySurface === 'monitor';
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 bg-blue-soft px-4 py-2 text-sm text-blue">
          <span>{wholeScreen ? t('screen.youEntire') : t('screen.you')}</span>
          <button type="button" onClick={onStop} className="btn btn-primary btn-sm">
            {t('bar.stopShare')}
          </button>
        </div>
        {wholeScreen ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted">
            <p>{t('screen.previewHidden')}</p>
            <p>{t('screen.tipNotifications')}</p>
          </div>
        ) : (
          <VideoTrack trackRef={ref} className="min-h-0 flex-1 bg-black object-contain" />
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full bg-[#14181f]">
      <VideoTrack trackRef={ref} className="h-full w-full object-contain" />
      <span className="absolute left-3 top-3 rounded bg-blue-soft px-2 py-0.5 text-xs text-blue">
        {t('screen.someoneSharing', { name: ref.participant.name || ref.participant.identity })}
      </span>
    </div>
  );
}
