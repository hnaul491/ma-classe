'use client';

import { useMediaDevices, usePreviewTracks } from '@livekit/components-react';
import { Track, VideoPresets, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '@/lib/lessons/types';
import { playTestSound, useMicLevel } from './audio';
import { usePresence } from './usePresence';

export interface JoinChoices {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputId?: string;
}

export function PreJoin({
  lessonId,
  role,
  error,
  planBUrl,
  onJoin,
}: {
  lessonId: string;
  role: Role;
  error: string | null;
  planBUrl: string;
  onJoin: (c: JoinChoices) => Promise<void>;
}) {
  const [videoDeviceId, setVideoDeviceId] = useState<string | undefined>();
  const [audioDeviceId, setAudioDeviceId] = useState<string | undefined>();
  const [audioOutputId, setAudioOutputId] = useState<string | undefined>();
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const options = useMemo(
    () => ({
      audio: audioDeviceId ? { deviceId: audioDeviceId } : true,
      video: { deviceId: videoDeviceId, resolution: VideoPresets.h540.resolution },
    }),
    [audioDeviceId, videoDeviceId],
  );
  const tracks = usePreviewTracks(options, (e) => setDeviceError(e.message));
  const videoTrack = tracks?.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
  const audioTrack = tracks?.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;

  const videoEl = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoEl.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  const level = useMicLevel(audioTrack?.mediaStreamTrack);
  const cams = useMediaDevices({ kind: 'videoinput' });
  const mics = useMediaDevices({ kind: 'audioinput' });
  const speakers = useMediaDevices({ kind: 'audiooutput' });
  const presence = usePresence(lessonId);
  const otherIn = role === 'student' ? presence.teacher : presence.student;
  const otherName = role === 'student' ? 'Teacher' : 'Your student';

  async function join() {
    setJoining(true);
    try {
      await onJoin({
        audioEnabled: Boolean(audioTrack),
        videoEnabled: Boolean(videoTrack),
        audioDeviceId,
        videoDeviceId,
        audioOutputId,
      });
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-4xl items-center gap-6 px-4 py-8 md:grid-cols-[1.2fr_1fr]">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-surface-2">
        {videoTrack ? (
          <video ref={videoEl} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">Camera is off</div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Camera
          <select
            id="prejoin-camera"
            className="rounded border border-line bg-surface px-2 py-1.5"
            value={videoDeviceId ?? ''}
            onChange={(e) => {
              setDeviceError(null);
              setVideoDeviceId(e.target.value || undefined);
            }}
          >
            <option value="">Default camera</option>
            {cams.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Camera'}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Microphone
          <select
            id="prejoin-mic"
            className="rounded border border-line bg-surface px-2 py-1.5"
            value={audioDeviceId ?? ''}
            onChange={(e) => {
              setDeviceError(null);
              setAudioDeviceId(e.target.value || undefined);
            }}
          >
            <option value="">Default microphone</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3 text-sm">
          <span className="w-24 text-muted">Mic level</span>
          <span className="h-2 flex-1 overflow-hidden rounded bg-surface-2" aria-hidden>
            <span className="block h-full bg-good" style={{ width: `${Math.round(Math.min(1, level * 3) * 100)}%` }} />
          </span>
        </div>

        {speakers.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            Speaker
            <select
              id="prejoin-speaker"
              className="rounded border border-line bg-surface px-2 py-1.5"
              value={audioOutputId ?? ''}
              onChange={(e) => setAudioOutputId(e.target.value || undefined)}
            >
              <option value="">Default speaker</option>
              {speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Speaker'}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() => playTestSound(audioOutputId)}
          className="self-start rounded bg-surface-2 px-3 py-1.5 text-sm"
        >
          Play test sound
        </button>

        <p className={otherIn ? 'text-good' : 'text-muted'}>
          {otherIn ? `${otherName} is in the room` : `${otherName} hasn't joined yet`}
        </p>

        {deviceError && (
          <p className="text-sm text-pen">
            Camera or microphone problem: {deviceError}. Check browser permissions, then reload.
          </p>
        )}
        {error && (
          <p className="text-sm text-pen">
            {error}{' '}
            <a href={planBUrl} target="_blank" rel="noopener" className="underline">
              Open Plan B
            </a>
          </p>
        )}

        <button
          type="button"
          onClick={join}
          disabled={joining}
          className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface disabled:opacity-60"
        >
          {joining ? 'Joining…' : 'Join lesson'}
        </button>
      </div>
    </main>
  );
}
