'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useEffect, useEffectEvent, useId, useImperativeHandle, useRef, useState, type FormEvent, type RefObject } from 'react';
import { AUDIO_MIMES, classifyDriveFile, type DriveFile } from '@/features/drive/classify';
import { driveErrorKey, openDrivePicker } from '@/features/drive/drive';
import { preloadDriveAuth } from '@/features/drive/token';
import { AudioPlayer } from '@/features/media/AudioPlayer';
import {
  applyPlan,
  classifyObserved,
  createEchoGuard,
  createSyncEcho,
  missedAction,
  routeMessage,
  shouldHeartbeat,
  sourceKey,
  stateMessage,
  type Observed,
  type ObservedVia,
  type PlayerControl,
} from '@/features/media/playback';
import { parseYouTubeId, type MediaMessage, type MediaSource } from '@/features/media/protocol';
import { HEARTBEAT_MS, INITIAL_MEDIA_STATE, mediaReducer, targetPosition, type MediaState } from '@/features/media/sync';
import { useMediaChannel } from '@/features/media/useMediaChannel';
import { YouTubePlayer } from '@/features/media/YouTubePlayer';
import { CloseIcon } from '@/features/room/icons';
import { googleConfig } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Member } from '@/lib/lessons/types';

/** Names and titles travel at most this long (as in the protocol). */
const MAX_NAME = 200;

type MediaSend = ReturnType<typeof useMediaChannel>['send'];

/** What RoomShell may ask of the media stage. */
export type MediaHandle = {
  /** An audio file picked on the board's Drive menu: play it here, for both. */
  openAudio: (f: DriveFile) => void;
};

export default function MediaStage({
  member,
  onError,
  onClose,
  handleRef,
}: {
  member: Member;
  onError: (key: MessageKey) => void;
  /** After Close media: back to the cameras. */
  onClose: () => void;
  handleRef?: RefObject<MediaHandle | null>;
}) {
  const t = useT();
  const room = useRoomContext();
  const role = member.role;
  const [state, setState] = useState<MediaState>(INITIAL_MEDIA_STATE);
  /** The state as of the last message or action (renders lag behind). */
  const stateRef = useRef(state);
  /** The ready player, with the media it plays. */
  const control = useRef<{ key: string; c: PlayerControl } | null>(null);
  const [guard] = useState(() => createEchoGuard());
  /** "The last seek was ours (sync), not the person's", and the one local resync it allows. */
  const [echo] = useState(() => createSyncEcho());
  /** The channel's `send`, for the actions (the hook is called below them). */
  const sendRef = useRef<MediaSend | null>(null);
  /** A check queued for when the echo guard ends. */
  const recheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The media whose autoplay was blocked: "Click to play" covers its player. */
  const [blockedFor, setBlockedFor] = useState<string | null>(null);
  const blockedRef = useRef<string | null>(null);
  const [url, setUrl] = useState('');
  const [badUrl, setBadUrl] = useState(false);
  const [picking, setPicking] = useState(false);
  const driveEnabled = googleConfig() !== null;
  const urlId = useId();
  const key = sourceKey(state.source);
  const blocked = key !== null && blockedFor === key;

  const block = (k: string | null) => {
    blockedRef.current = k;
    setBlockedFor(k);
  };

  const commit = (next: MediaState) => {
    stateRef.current = next;
    setState(next);
  };

  /** The player of the current media, if it is ready. */
  const player = (): PlayerControl | null => {
    const cur = control.current;
    return cur && cur.key === sourceKey(stateRef.current.source) ? cur.c : null;
  };

  /** Where this player really is, or null when it is not playing as it should (blocked, loading). */
  const livePosition = (): number | null => {
    const c = player();
    const s = stateRef.current;
    if (!c || blockedRef.current === sourceKey(s.source)) return null;
    return s.playing && !c.playing() ? null : c.position();
  };

  /**
   * When the guard ends: a play or pause the person took inside it is an action; a position off by the
   * buffering time of our own seek or play is only a local resync.
   */
  function checkAfterGuard() {
    if (recheck.current) return;
    const left = guard.remaining();
    recheck.current = setTimeout(
      () => {
        recheck.current = null;
        if (guard.active()) return checkAfterGuard();
        const c = player();
        const s = stateRef.current;
        if (!c || !s.source) return;
        const missed = missedAction(s, { playing: c.playing(), position: c.position() }, Date.now(), blockedRef.current === sourceKey(s.source));
        if (missed?.kind === 'action') act({ source: s.source, ...missed.observed });
        else if (missed?.kind === 'resync') resync();
        // Paused: no PLAYING will come to settle the echo.
        if (!stateRef.current.playing) echo.settle();
      },
      // While a play is pending, look again shortly; otherwise just after the window.
      left === Infinity ? 250 : left + 20,
    );
  }

  /**
   * Makes the player match the shared state; its own events meanwhile are not actions. `remote`: the
   * state changed (or a player became ready), which marks the sync echo, allows one local resync and
   * checks once when the guard ends. `resync`: a local correction (buffering made the player fall
   * behind), which sends nothing and checks nothing more.
   */
  function syncPlayer(origin: 'remote' | 'resync') {
    const c = player();
    const s = stateRef.current;
    // Blocked: retrying without a click would fail again; "Click to play" catches up.
    if (!c || !s.source || blockedRef.current === sourceKey(s.source)) return;
    const plan = applyPlan(s, { position: c.position(), playing: c.playing() }, Date.now());
    if (plan.seekTo === null && !plan.play && !plan.pause) return;
    // This seek or play is ours: its late PLAYING (after buffering) is not the person's seek.
    if (plan.seekTo !== null || plan.play) {
      if (origin === 'remote') echo.mark();
      else echo.rearm();
    }
    guard.begin();
    if (plan.seekTo !== null) c.seek(plan.seekTo);
    if (plan.pause) c.pause();
    if (plan.play) playNow(c);
    if (origin === 'remote') checkAfterGuard();
  }

  /** A local correction, at most once per sync: never sent, so it cannot pull the other person back. */
  function resync() {
    if (echo.takeResync()) syncPlayer('resync');
  }

  function playNow(c: PlayerControl) {
    const forKey = sourceKey(stateRef.current.source);
    const release = guard.hold();
    void c.play().then((ok) => {
      release();
      const s = stateRef.current;
      if (sourceKey(s.source) !== forKey) return;
      block(ok || !s.playing ? null : forKey);
    });
  }

  /** A local action: bump, keep, and tell the other person. */
  function act(next: { source: MediaSource | null; playing: boolean; position: number }) {
    const s = mediaReducer(stateRef.current, { type: 'local', next: { ...next, sentAt: Date.now(), by: role } });
    commit(s);
    // The person acted: no pending sync echo or resync applies any more.
    echo.clear();
    const msg = stateMessage(s, s.position, s.sentAt);
    if (msg) void sendRef.current?.(msg).catch(() => {});
  }

  function load(source: MediaSource) {
    block(null);
    void sendRef.current?.({ t: 'media-load', source, at: Date.now() }).catch(() => {});
    act({ source, playing: false, position: 0 });
  }

  function openAudio(f: DriveFile) {
    const c = classifyDriveFile(f);
    if (c.kind === 'reject') return onError(c.reason);
    if (c.kind !== 'audio') return onError('drive.unsupported');
    load({ kind: 'audio', driveId: f.id, name: f.name.slice(0, MAX_NAME), mimeType: f.mimeType });
  }

  useImperativeHandle(handleRef, () => ({ openAudio }));

  const onControl = (forKey: string, c: PlayerControl | null) => {
    if (c) {
      control.current = { key: forKey, c };
      syncPlayer('remote');
    } else if (control.current?.key === forKey) {
      control.current = null;
    }
  };

  useEffect(() => () => clearTimeout(recheck.current ?? undefined), []);

  const onObserved = (o: Observed, via: ObservedVia) => {
    const s = stateRef.current;
    if (blockedRef.current === sourceKey(s.source)) return;
    if (guard.active()) return checkAfterGuard();
    const verdict = classifyObserved(s, o, via, Date.now(), echo.pending());
    if (verdict === 'action') act({ source: s.source, playing: o.playing, position: o.position });
    else if (verdict === 'resync') resync();
  };

  /**
   * Playback really started (after `onObserved` saw the same PLAYING): it settles the sync echo, and a
   * stale "blocked" mark (a slow buffer, not autoplay) goes while the player catches up locally.
   */
  const onPlaying = () => {
    const k = sourceKey(stateRef.current.source);
    if (k !== null && blockedRef.current === k) {
      block(null);
      resync();
    }
    echo.settle();
  };

  // Received messages: a reply or an answer goes to its sender only; a changed state is applied.
  const { send } = useMediaChannel((msg: MediaMessage, from: string) => {
    const prev = stateRef.current;
    const r = routeMessage(prev, msg, from, { self: role, position: livePosition(), now: Date.now() });
    // A media-req answer, or my state for someone whose state is stale.
    if (r.reply) void sendRef.current?.(r.reply.msg, { to: r.reply.to }).catch(() => {});
    if (r.next === prev) return;
    commit(r.next);
    if (!r.next.playing) block(null);
    // A new media mounts a new player, which syncs when ready.
    if (r.syncPlayer) syncPlayer('remote');
  });
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Late join, reload and reconnect: ask for the current media on mount, once connected, after a
  // reconnect (messages may have been lost meanwhile), and when the other person joins (the first
  // request may have gone out before anyone could answer).
  useEffect(() => {
    const ask = () => void send({ t: 'media-req' }).catch(() => {});
    ask();
    room.on(RoomEvent.Connected, ask);
    room.on(RoomEvent.Reconnected, ask);
    room.on(RoomEvent.ParticipantConnected, ask);
    return () => {
      room.off(RoomEvent.Connected, ask);
      room.off(RoomEvent.Reconnected, ask);
      room.off(RoomEvent.ParticipantConnected, ask);
    };
  }, [room, send]);

  // While playing, the person who acted last re-sends the state every 5 s (counted from each action),
  // so drift is corrected on the other side.
  const beating = shouldHeartbeat(state, role);
  const beat = useEffectEvent(() => {
    const s = stateRef.current;
    if (!shouldHeartbeat(s, role)) return;
    const msg = stateMessage(s, livePosition(), Date.now());
    if (msg) void send(msg).catch(() => {});
  });
  useEffect(() => {
    if (!beating) return;
    const id = setInterval(() => beat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [beating, state.lamport]);

  // Loads Google sign-in ahead, so the Drive button's pop-up opens inside its click.
  useEffect(() => {
    if (driveEnabled) void preloadDriveAuth();
  }, [driveEnabled]);

  const submitUrl = (e: FormEvent) => {
    e.preventDefault();
    const videoId = parseYouTubeId(url);
    if (!videoId) return setBadUrl(true);
    setBadUrl(false);
    setUrl('');
    load({ kind: 'youtube', videoId });
  };

  const pickAudio = () => {
    if (picking) return;
    // First, with no await before it: the Google pop-up must open inside the click.
    let picked: Promise<DriveFile | null>;
    try {
      picked = openDrivePicker({ mimeTypes: AUDIO_MIMES });
    } catch (err) {
      picked = Promise.reject(err);
    }
    setPicking(true);
    picked
      .then(
        (f) => {
          if (f) openAudio(f);
        },
        (err: unknown) => onError(driveErrorKey(err)),
      )
      .finally(() => setPicking(false));
  };

  const clickToPlay = () => {
    const c = player();
    const s = stateRef.current;
    if (!c) return;
    // Inside the click, so the browser allows it; from where the other person is now.
    echo.mark();
    guard.begin();
    c.seek(targetPosition(s, Date.now()));
    block(null);
    playNow(c);
    checkAfterGuard();
  };

  const close = () => {
    block(null);
    act({ source: null, playing: false, position: 0 });
    onClose();
  };

  const source = state.source;

  return (
    <div data-testid="media-stage" className="relative flex h-full w-full items-center justify-center bg-paper p-4">
      {!source && (
        <div className="card flex w-full max-w-md flex-col gap-4 p-5">
          <h2 className="text-base font-semibold">{t('media.title')}</h2>
          <form onSubmit={submitUrl} className="flex flex-col gap-2" noValidate>
            <label htmlFor={urlId} className="text-sm font-medium">
              {t('media.urlLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id={urlId}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.youtube.com/watch?v=…"
                className="field min-w-0 flex-1"
                value={url}
                aria-invalid={badUrl || undefined}
                aria-describedby={badUrl ? `${urlId}-error` : undefined}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setBadUrl(false);
                }}
              />
              <button type="submit" className="btn btn-primary">
                {t('media.play')}
              </button>
            </div>
            {badUrl && (
              <p id={`${urlId}-error`} role="alert" className="text-sm text-pen">
                {t('media.badUrl')}
              </p>
            )}
          </form>
          {driveEnabled && (
            <>
              <p className="text-center text-xs text-muted">{t('media.or')}</p>
              <button type="button" className="btn btn-secondary" aria-disabled={picking || undefined} onClick={pickAudio}>
                {t('media.fromDrive')}
              </button>
            </>
          )}
        </div>
      )}

      {source && (
        <>
          <button type="button" className="btn btn-secondary btn-sm absolute left-3 top-3 z-10 gap-1.5" onClick={close}>
            <CloseIcon />
            {t('media.close')}
          </button>
          <div className="relative flex h-full w-full items-center justify-center pt-10" style={{ containerType: 'size' }}>
            {source.kind === 'youtube' ? (
              // The largest 16:9 box that fits.
              <div className="overflow-hidden rounded-lg bg-black" style={{ width: 'min(100cqw, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' }}>
                <YouTubePlayer
                  key={key}
                  videoId={source.videoId}
                  onControl={(c) => onControl(key!, c)}
                  onObserved={onObserved}
                  onPlaying={onPlaying}
                  onError={onError}
                />
              </div>
            ) : (
              <AudioPlayer
                key={key}
                source={source}
                onControl={(c) => onControl(key!, c)}
                onObserved={onObserved}
                onPlaying={onPlaying}
                onError={onError}
              />
            )}
            {blocked && (
              <button
                type="button"
                onClick={clickToPlay}
                className="absolute inset-0 z-10 flex items-center justify-center bg-ink/40 text-lg font-semibold text-surface"
              >
                <span className="rounded-full bg-blue px-5 py-2.5 shadow-lg">{t('media.clickToPlay')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
