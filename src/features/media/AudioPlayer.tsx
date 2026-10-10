'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { downloadDriveFile, driveErrorKey } from '@/features/drive/drive';
import { getDriveToken } from '@/features/drive/token';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { audioLoadProblem } from './audioError';
import { loadObjectUrl } from './objectUrl';
import { isAutoplayRejection, type Observed, type ObservedVia, type PlayerControl } from './playback';
import type { MediaSource } from './protocol';

type AudioSource = Extract<MediaSource, { kind: 'audio' }>;
type Loaded = { key: string; url: string } | { key: string; problem: 'connect' | 'noAccess' | 'failed' };

/**
 * A Drive audio file with the browser's own controls. Each browser downloads its own copy with its own
 * Google token (never a pop-up outside a click: "Connect Google Drive to play" asks for one), and plays
 * it from an object URL, revoked when the file changes or on unmount. Its play, pause and seeked events
 * go to `onObserved`.
 */
export function AudioPlayer({
  source,
  onControl,
  onObserved,
  onPlaying,
  onError,
}: {
  source: AudioSource;
  /** The player's controls once the audio is ready; null when it goes away. */
  onControl: (c: PlayerControl | null) => void;
  /** `via`: play or pause (`state`), or seeked (`seek`). */
  onObserved: (o: Observed, via: ObservedVia) => void;
  /** Playback really started (the browser's `playing`): an autoplay mark is stale. */
  onPlaying: () => void;
  onError: (key: MessageKey) => void;
}) {
  const t = useT();
  /** Bumped by Try again and after connecting Drive: downloads again. */
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [connecting, setConnecting] = useState(false);
  const key = `${source.driveId}:${attempt}`;
  const current = loaded?.key === key ? loaded : null;
  const url = current && 'url' in current ? current.url : null;
  const control = useEffectEvent(onControl);

  useEffect(
    () =>
      loadObjectUrl(
        () => downloadDriveFile({ id: source.driveId, name: source.name, mimeType: source.mimeType, sizeBytes: null }),
        { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) },
        (r) => setLoaded('url' in r ? { key, url: r.url } : { key, problem: audioLoadProblem(r.error) }),
      ),
    [key, source.driveId, source.name, source.mimeType],
  );

  // The controls belong to this URL's element: gone with it.
  useEffect(() => {
    if (!url) return;
    return () => control(null);
  }, [url]);

  const connect = () => {
    // First, with no await before it: the Google pop-up must open inside the click.
    const token = getDriveToken();
    setConnecting(true);
    token.then(
      () => setAttempt((a) => a + 1),
      (e: unknown) => onError(driveErrorKey(e)),
    ).finally(() => setConnecting(false));
  };

  const observe = (el: HTMLAudioElement, playing: boolean, via: ObservedVia) => onObserved({ playing, position: el.currentTime }, via);

  return (
    <div className="card flex w-full max-w-lg flex-col gap-3 p-4">
      <p className="truncate text-sm font-medium" title={source.name}>
        {source.name}
      </p>
      {!current && (
        <p role="status" className="text-sm text-muted">
          {t('media.loading')}
        </p>
      )}
      {current && 'problem' in current && current.problem === 'connect' && (
        <button type="button" className="btn btn-primary self-start" disabled={connecting} onClick={connect}>
          {t('media.connectDrive')}
        </button>
      )}
      {current && 'problem' in current && current.problem === 'noAccess' && (
        <p role="alert" className="text-sm">
          {t('media.noAccess')}
        </p>
      )}
      {current && 'problem' in current && current.problem === 'failed' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t('media.failed')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((a) => a + 1)}>
            {t('error.retry')}
          </button>
        </div>
      )}
      {url && (
        <audio
          key={url}
          src={url}
          controls
          preload="auto"
          className="w-full"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            onControl({
              position: () => el.currentTime,
              playing: () => !el.paused,
              play: () => el.play().then(
                () => true,
                (err: unknown) => !isAutoplayRejection(err),
              ),
              pause: () => el.pause(),
              seek: (s) => {
                el.currentTime = s;
              },
            });
          }}
          onPlay={(e) => observe(e.currentTarget, true, 'state')}
          onPlaying={() => onPlaying()}
          onPause={(e) => observe(e.currentTarget, false, 'state')}
          onSeeked={(e) => observe(e.currentTarget, !e.currentTarget.paused, 'seek')}
          onError={() => setLoaded({ key, problem: 'failed' })}
        />
      )}
    </div>
  );
}
