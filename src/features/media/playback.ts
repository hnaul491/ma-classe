// Pure playback rules for the media stage: what is an echo, who sends the heartbeat, what to do to the
// player for a state, when autoplay counts as blocked, and what is a seek. No React, no browser.

import type { Role } from '@/lib/lessons/types';
import type { MediaMessage, MediaSource } from './protocol';
import { needsCorrection, receiveState, targetPosition, type MediaState } from './sync';

/** Player events this soon after applying a remote state are its echo, not the person's action. */
export const ECHO_GUARD_MS = 500;

/**
 * The "applying" flag. `begin()` opens a 500 ms window (a seek, a pause). `hold()` keeps it open until
 * the returned release is called (a play that may take a while), then leaves the same 500 ms tail.
 */
export function createEchoGuard(now: () => number = Date.now) {
  let until = 0;
  let holds = 0;
  const begin = () => {
    until = Math.max(until, now() + ECHO_GUARD_MS);
  };
  return {
    begin,
    hold(): () => void {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        begin();
      };
    },
    active: (): boolean => holds > 0 || now() < until,
    /** Milliseconds until the window ends: Infinity while held, 0 once over. */
    remaining: (): number => (holds > 0 ? Infinity : Math.max(0, until - now())),
  };
}

export type Observed = { playing: boolean; position: number };

/**
 * True when a player event differs from the shared state: play/pause flipped, or the position is
 * beyond the drift threshold from where playback should be. An event that matches is an echo (e.g. a
 * PLAYING that arrives after the 500 ms window, once a remote seek finished buffering).
 */
export function isLocalChange(state: MediaState, observed: Observed, now: number): boolean {
  if (!state.source) return false;
  if (observed.playing !== state.playing) return true;
  return needsCorrection(observed.position, targetPosition(state, now));
}

/** While playing, only the person who acted last re-sends the state. */
export function shouldHeartbeat(state: MediaState, role: Role): boolean {
  return state.source !== null && state.playing && state.by === role;
}

/**
 * The state to send now, as a heartbeat or as a reply to `media-req`: the same Lamport counter and
 * author, at the player's position (or, without a player, where playback should be). Null before
 * anyone acted.
 */
export function stateMessage(state: MediaState, position: number | null, now: number): Extract<MediaMessage, { t: 'media-state' }> | null {
  if (state.by === null || state.lamport === 0) return null;
  const at = position ?? targetPosition(state, now);
  return { t: 'media-state', source: state.source, playing: state.playing, position: Math.max(0, at), sentAt: now, lamport: state.lamport, by: state.by };
}

export type ApplyPlan = { seekTo: number | null; play: boolean; pause: boolean };

/** What to do to the local player so it matches `state`. */
export function applyPlan(state: MediaState, local: Observed, now: number): ApplyPlan {
  const target = targetPosition(state, now);
  return {
    seekTo: needsCorrection(local.position, target) ? target : null,
    play: state.playing && !local.playing,
    pause: !state.playing && local.playing,
  };
}

/** `YT.PlayerState` values. */
export const YT_UNSTARTED = -1;
export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_PAUSED = 2;
export const YT_BUFFERING = 3;
export const YT_CUED = 5;

/** `playVideo()` that has not reached PLAYING by then was blocked by the browser's autoplay rule. */
export const AUTOPLAY_TIMEOUT_MS = 1500;
/** Still buffering (slow connection) gets this long in all. */
export const AUTOPLAY_MAX_WAIT_MS = 5000;

/** After `playVideo()`: playing, keep waiting, or blocked ("Click to play"). */
export function autoplayVerdict(playerState: number, elapsedMs: number): 'playing' | 'wait' | 'blocked' {
  if (playerState === YT_PLAYING) return 'playing';
  const limit = playerState === YT_BUFFERING ? AUTOPLAY_MAX_WAIT_MS : AUTOPLAY_TIMEOUT_MS;
  return elapsedMs >= limit ? 'blocked' : 'wait';
}

/** The YouTube player has no seek event: its time is sampled this often. */
export const SEEK_POLL_MS = 500;
/** A jump larger than this from where the video should be is a seek. */
export const SEEK_JUMP_S = 1;
/** Samples further apart than this (a throttled background tab) only reset the baseline. */
export const SEEK_MAX_GAP_MS = 2000;

export type Sample = { at: number; position: number; playing: boolean };

/** True when the time moved by more than the threshold away from where the previous sample predicts. */
export function isSeekJump(prev: Sample, cur: Sample, thresholdSec = SEEK_JUMP_S): boolean {
  const gap = cur.at - prev.at;
  if (gap <= 0 || gap > SEEK_MAX_GAP_MS) return false;
  const expected = prev.position + (prev.playing ? gap / 1000 : 0);
  return Math.abs(cur.position - expected) > thresholdSec;
}

/** A YouTube state change as a play or pause, or null for states that are not an action. */
export function ytObserved(playerState: number, position: number): Observed | null {
  if (playerState === YT_PLAYING) return { playing: true, position };
  if (playerState === YT_PAUSED || playerState === YT_ENDED) return { playing: false, position };
  return null;
}

/** A YouTube time sample for seek detection, or null while buffering (a stall is not a seek). */
export function ytSample(playerState: number, position: number, at: number): Sample | null {
  if (playerState === YT_BUFFERING) return null;
  return { at, position, playing: playerState === YT_PLAYING };
}

/** True when `audio.play()` was refused by the browser's autoplay rule (not interrupted by a pause). */
export function isAutoplayRejection(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'NotAllowedError';
}

/** What the media stage needs from a player (YouTube or audio). */
export type PlayerControl = {
  /** Seconds. */
  position(): number;
  /** Playing, or about to (buffering). */
  playing(): boolean;
  /** Resolves false when the browser blocked it (autoplay): show "Click to play". */
  play(): Promise<boolean>;
  pause(): void;
  seek(seconds: number): void;
};

export type Routed = {
  next: MediaState;
  /** A message for one person only (`to`): a media-req answer, or my state for a stale sender. */
  reply: { to: string[]; msg: Extract<MediaMessage, { t: 'media-state' }> } | null;
  /** The state changed for the media already playing: make its player match now. */
  syncPlayer: boolean;
};

/**
 * What the media stage does with a received message. `position` is where my player really is (null
 * when it is not playing as it should): replies carry it, so a joiner lands where I am.
 */
export function routeMessage(
  state: MediaState,
  msg: MediaMessage,
  from: string,
  ctx: { self: Role; position: number | null; now: number },
): Routed {
  const answer = () => {
    const m = stateMessage(state, ctx.position, ctx.now);
    return m ? { to: [from], msg: m } : null;
  };
  switch (msg.t) {
    case 'media-req':
      return { next: state, reply: answer(), syncPlayer: false };
    case 'media-state': {
      const r = receiveState(state, msg, ctx.self);
      if (r.next === state) return { next: state, reply: r.answer ? answer() : null, syncPlayer: false };
      const sameMedia = sourceKey(r.next.source) === sourceKey(state.source);
      return { next: r.next, reply: null, syncPlayer: sameMedia };
    }
    default:
      // media-load: the media-state that follows carries everything.
      return { next: state, reply: null, syncPlayer: false };
  }
}

/** One key per media, so a new one mounts a new player. */
export function sourceKey(src: MediaSource | null): string | null {
  if (!src) return null;
  return src.kind === 'youtube' ? `yt:${src.videoId}` : `audio:${src.driveId}`;
}

/** A sync seek or play whose PLAYING has not come yet is forgotten after this. */
export const SYNC_ECHO_TTL_MS = 10_000;

/**
 * "The last seek (or play) was ours, not the person's." Set by every correction that comes from the
 * shared state (`mark`); its late PLAYING, after buffering, then reads as an echo, not a user seek.
 * `settle()` on that PLAYING; `clear()` on a local action. Each mark allows one local resync, and the
 * resync only re-arms the echo (`rearm`), so a slow buffer can never loop into corrective seeks.
 */
export function createSyncEcho(now: () => number = Date.now) {
  let at: number | null = null;
  let budget = 0;
  return {
    mark(): void {
      at = now();
      budget = 1;
    },
    rearm(): void {
      at = now();
    },
    settle(): void {
      at = null;
    },
    clear(): void {
      at = null;
      budget = 0;
    },
    pending: (): boolean => at !== null && now() - at < SYNC_ECHO_TTL_MS,
    takeResync(): boolean {
      if (budget <= 0) return false;
      budget -= 1;
      return true;
    },
  };
}

/** `state`: a play or pause (YouTube state change, audio play/pause); `seek`: a detected seek (time jump, audio seeked). */
export type ObservedVia = 'state' | 'seek';

/**
 * A player event outside the echo guard. A play/pause flip is the person's action. A position away
 * from the target is their seek, except on a state change that follows a sync seek or play (the late
 * PLAYING after buffering): that only resyncs this player, sending nothing.
 */
export function classifyObserved(state: MediaState, o: Observed, via: ObservedVia, now: number, syncPending: boolean): 'action' | 'resync' | 'ignore' {
  if (!isLocalChange(state, o, now)) return 'ignore';
  if (o.playing !== state.playing) return 'action';
  return via === 'state' && syncPending ? 'resync' : 'action';
}

/**
 * When the echo guard ends, after a swallowed event. Only a play/pause that differs from the synced
 * state is the person's action (taken inside the window). A position that differs is most often the
 * buffering time of our own seek or play (the target moved on meanwhile): resync locally, send
 * nothing. A real seek inside the window may be lost; that is the accepted trade-off. Nothing for a
 * blocked player.
 */
export function missedAction(
  state: MediaState,
  actual: Observed,
  now: number,
  blocked: boolean,
): { kind: 'action'; observed: Observed } | { kind: 'resync' } | null {
  if (blocked || !isLocalChange(state, actual, now)) return null;
  return actual.playing !== state.playing ? { kind: 'action', observed: actual } : { kind: 'resync' };
}
