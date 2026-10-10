'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { downloadDriveFile, driveErrorKey } from '@/features/drive/drive';
import { getDriveToken } from '@/features/drive/token';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { audioLoadProblem } from './audioError';
import { isAutoplayRejection, type Observed, type PlayerControl } from './playback';
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
  onError,
}: {
  source: AudioSource;
  /** The player's controls once the audio is ready; null when it goes away. */
  onControl: (c: PlayerControl | null) => void;
  onObserved: (o: Observed) => void;
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

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    downloadDriveFile({ id: source.driveId, name: source.name, mimeType: source.mimeType, sizeBytes: null }).then(
      (file) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(file);
        setLoaded({ key, url: objectUrl });
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ key, problem: audioLoadProblem(e) });
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, source.driveId, source.name, source.mimeType]);

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

  const observe = (el: HTMLAudioElement, playing: boolean) => onObserved({ playing, position: el.currentTime });

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
          onPlay={(e) => observe(e.currentTarget, true)}
          onPause={(e) => observe(e.currentTarget, false)}
          onSeeked={(e) => observe(e.currentTarget, !e.currentTarget.paused)}
          onError={() => setLoaded({ key, problem: 'failed' })}
        />
      )}
    </div>
  );
}
