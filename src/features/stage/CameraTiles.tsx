'use client';

import { isTrackReference, useTracks, VideoTrack, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track } from 'livekit-client';

function CameraTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const p = trackRef.participant;
  const name = p.name || p.identity;
  const label = p.isLocal ? 'You' : name;
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  return (
    <div data-testid="camera-tile" className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface-2">
      {showVideo ? (
        <VideoTrack trackRef={trackRef} className={`h-full w-full object-cover ${p.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-soft text-lg font-semibold text-blue">
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <span className="absolute bottom-1 left-2 rounded bg-black/55 px-1.5 text-xs text-white">{label}</span>
    </div>
  );
}

export function CameraTiles({ variant }: { variant: 'stage' | 'rail' }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  return (
    <div
      className={
        variant === 'stage'
          ? 'grid h-full w-full grid-cols-1 content-center gap-3 p-4 sm:grid-cols-2'
          : 'flex flex-col gap-2 p-2'
      }
    >
      {tracks.map((t) => (
        <CameraTile key={`${t.participant.identity}-${t.source}`} trackRef={t} />
      ))}
    </div>
  );
}
