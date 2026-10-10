'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { autoplayVerdict, SEEK_POLL_MS, isSeekJump, ytObserved, ytSample, YT_BUFFERING, YT_PLAYING, type Observed, type ObservedVia, type PlayerControl, type Sample } from './playback';
import { loadYouTube, YOUTUBE_HOST } from './youtubeApi';

/** How often a pending `playVideo()` checks whether it reached PLAYING. */
const AUTOPLAY_CHECK_MS = 250;
/** YouTube error codes for a video whose owner does not allow embedding. */
const NOT_EMBEDDABLE = [101, 150];

/**
 * A YouTube player with its own controls. Its play, pause and seeks (seen as jumps in the time, which
 * the API does not report) go to `onObserved`; the stage decides what is a real action. The player is
 * created for `videoId` and destroyed when it changes or on unmount.
 */
export function YouTubePlayer({
  videoId,
  onControl,
  onObserved,
  onPlaying,
  onError,
}: {
  videoId: string;
  /** The player's controls once it is ready; null when it goes away. */
  onControl: (c: PlayerControl | null) => void;
  /** `via`: a state change (play, pause) or a detected seek (a jump in the time). */
  onObserved: (o: Observed, via: ObservedVia) => void;
  /** The player reached PLAYING (even late, after a slow buffer): an autoplay mark is stale. */
  onPlaying: () => void;
  onError: (key: 'media.failed' | 'media.notEmbeddable') => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const control = useEffectEvent(onControl);
  const observed = useEffectEvent(onObserved);
  const nowPlaying = useEffectEvent(onPlaying);
  const failed = useEffectEvent(onError);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // The API replaces this element with its iframe, so React does not own it.
    const target = document.createElement('div');
    host.appendChild(target);
    let cancelled = false;
    let player: YT.Player | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let prev: Sample | null = null;
    /** Pending `play()` checks, run on every state change; on unmount they settle as played. */
    const pending = new Set<(destroyed?: boolean) => void>();

    const time = () => {
      try {
        return player?.getCurrentTime() ?? 0;
      } catch {
        return 0;
      }
    };
    const state = () => {
      try {
        return player?.getPlayerState() ?? -1;
      } catch {
        return -1;
      }
    };

    const ctl: PlayerControl = {
      position: time,
      playing: () => state() === YT_PLAYING || state() === YT_BUFFERING,
      play: () =>
        new Promise<boolean>((resolve) => {
          const started = Date.now();
          const finish = (ok: boolean) => {
            pending.delete(check);
            clearInterval(timer);
            resolve(ok);
          };
          const check = (destroyed?: boolean) => {
            if (destroyed) return finish(true);
            const verdict = autoplayVerdict(state(), Date.now() - started);
            if (verdict !== 'wait') finish(verdict === 'playing');
          };
          const timer = setInterval(check, AUTOPLAY_CHECK_MS);
          pending.add(check);
          player?.playVideo();
        }),
      pause: () => player?.pauseVideo(),
      seek: (s) => {
        player?.seekTo(s, true);
        prev = null; // the jump is ours: start the seek detection afresh
      },
    };

    loadYouTube().then(
      (Player) => {
        if (cancelled) return;
        player = new Player(target, {
          videoId,
          host: YOUTUBE_HOST,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              if (cancelled) return;
              control(ctl);
              poll = setInterval(() => {
                const cur = ytSample(state(), time(), Date.now());
                if (prev && cur && isSeekJump(prev, cur)) observed({ playing: cur.playing, position: cur.position }, 'seek');
                prev = cur;
              }, SEEK_POLL_MS);
            },
            onStateChange: (e) => {
              for (const check of [...pending]) check();
              const o = ytObserved(e.data, time());
              if (o) observed(o, 'state');
              // After the event above, so a late autoplay is not mistaken for the person's play.
              if (e.data === YT_PLAYING) nowPlaying();
            },
            onError: (e) => failed(NOT_EMBEDDABLE.includes(e.data) ? 'media.notEmbeddable' : 'media.failed'),
          },
        });
      },
      () => {
        if (!cancelled) failed('media.failed');
      },
    );

    return () => {
      cancelled = true;
      clearInterval(poll);
      for (const check of [...pending]) check(true);
      control(null);
      try {
        player?.destroy();
      } catch {
        // Already gone with its iframe.
      }
      target.remove();
    };
  }, [videoId]);

  return <div ref={hostRef} className="h-full w-full [&>*]:h-full [&>*]:w-full" />;
}
