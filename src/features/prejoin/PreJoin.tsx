'use client';

import { useMediaDevices, usePreviewTracks } from '@livekit/components-react';
import { Track, VideoPresets, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { Role } from '@/lib/lessons/types';
import { playTestSound, useMicLevel } from './audio';
import { MicTest } from './MicTest';

/** Own component so the 60 fps level updates re-render only the meter, not the whole screen. */
function MicMeter({ track, label }: { track?: MediaStreamTrack; label: string }) {
  const level = useMicLevel(track);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 font-medium">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full bg-good transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, level * 3) * 100)}%` }} />
      </span>
    </div>
  );
}
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
  const t = useT();
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
  // usePreviewTracks restarts the camera and mic whenever this callback changes, so it must be stable.
  const onPreviewError = useCallback((e: Error) => setDeviceError(e.message), []);
  const tracks = usePreviewTracks(options, onPreviewError);
  const videoTrack = tracks?.find((tr) => tr.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
  const audioTrack = tracks?.find((tr) => tr.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;

  const videoEl = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoEl.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  const cams = useMediaDevices({ kind: 'videoinput' });
  const mics = useMediaDevices({ kind: 'audioinput' });
  const speakers = useMediaDevices({ kind: 'audiooutput' });
  const presence = usePresence(lessonId);
  const otherIn = role === 'student' ? presence.teacher : presence.student;

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
    <main className="mx-auto grid min-h-dvh w-full max-w-4xl items-center gap-8 px-4 py-10 md:grid-cols-[1.2fr_1fr]">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-surface-2">
        {videoTrack ? (
          <video ref={videoEl} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">{t('prejoin.cameraOff')}</div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <label className="field-label">
          {t('prejoin.camera')}
          <select
            id="prejoin-camera"
            className="field"
            value={videoDeviceId ?? ''}
            onChange={(e) => {
              setDeviceError(null);
              setVideoDeviceId(e.target.value || undefined);
            }}
          >
            <option value="">{t('prejoin.defaultCamera')}</option>
            {cams.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('prejoin.camera')}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          {t('prejoin.mic')}
          <select
            id="prejoin-mic"
            className="field"
            value={audioDeviceId ?? ''}
            onChange={(e) => {
              setDeviceError(null);
              setAudioDeviceId(e.target.value || undefined);
            }}
          >
            <option value="">{t('prejoin.defaultMic')}</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('prejoin.mic')}
              </option>
            ))}
          </select>
        </label>

        <MicMeter track={audioTrack?.mediaStreamTrack} label={t('prejoin.micLevel')} />

        {speakers.length > 0 && (
          <label className="field-label">
            {t('prejoin.speaker')}
            <select
              id="prejoin-speaker"
              className="field"
              value={audioOutputId ?? ''}
              onChange={(e) => setAudioOutputId(e.target.value || undefined)}
            >
              <option value="">{t('prejoin.defaultSpeaker')}</option>
              {speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t('prejoin.speaker')}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={() => void playTestSound(audioOutputId)}
            className="btn btn-secondary btn-sm"
          >
            {t('prejoin.testSound')}
          </button>
          <MicTest track={audioTrack?.mediaStreamTrack} outputDeviceId={audioOutputId} />
        </div>

        <p className={`flex items-center gap-2 text-sm ${otherIn ? 'text-good' : 'text-muted'}`}>
          <span className={`size-2 rounded-full ${otherIn ? 'bg-good' : 'bg-line'}`} aria-hidden />
          {role === 'student'
            ? t(otherIn ? 'prejoin.teacherIn' : 'prejoin.teacherNotIn')
            : t(otherIn ? 'prejoin.studentIn' : 'prejoin.studentNotIn')}
        </p>

        {deviceError && (
          <p role="alert" className="rounded-lg bg-pen-soft px-3 py-2 text-sm text-pen">
            {t('prejoin.deviceProblem', { error: deviceError })}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-pen-soft px-3 py-2 text-sm text-pen">
            {error}{' '}
            <a href={planBUrl} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
              {t('common.openPlanB')}
            </a>
          </p>
        )}

        <button
          type="button"
          onClick={join}
          disabled={joining}
          className="btn btn-primary w-full"
        >
          {joining ? t('prejoin.joining') : t('home.joinLesson')}
        </button>
      </div>
    </main>
  );
}
