'use client';

import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function ScreenView({ onStop }: { onStop: () => void }) {
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const ref = tracks[tracks.length - 1];
  if (!ref) return <div className="flex h-full items-center justify-center text-muted">No one is sharing.</div>;

  if (ref.participant.isLocal) {
    const settings = ref.publication.track?.mediaStreamTrack.getSettings() as
      | (MediaTrackSettings & { displaySurface?: string })
      | undefined;
    const wholeScreen = settings?.displaySurface === 'monitor';
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 bg-blue-soft px-4 py-2 text-sm text-blue">
          <span>You are sharing your {wholeScreen ? 'entire screen' : 'screen'}.</span>
          <button type="button" onClick={onStop} className="rounded bg-blue px-3 py-1 font-semibold text-surface">
            Stop sharing
          </button>
        </div>
        {wholeScreen ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted">
            <p>Your preview is hidden so you don’t see a mirror inside a mirror.</p>
            <p>Tip: turn off notifications so private messages don’t appear on the shared screen.</p>
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
        {ref.participant.name || ref.participant.identity} is sharing their screen
      </span>
    </div>
  );
}
