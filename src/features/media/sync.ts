import type { Role } from '@/lib/lessons/types';
import type { MediaMessage, MediaSource } from './protocol';

/** Seconds of drift tolerated before a receiver seeks to match. */
export const DRIFT_THRESHOLD_S = 1;
/** While playing, the person who last acted re-sends the state this often. */
export const HEARTBEAT_MS = 5000;

/** `by`: who acted last (null before anyone did). */
export type MediaState = { source: MediaSource | null; playing: boolean; position: number; sentAt: number; lamport: number; by: Role | null };

export const INITIAL_MEDIA_STATE: MediaState = { source: null, playing: false, position: 0, sentAt: 0, lamport: 0, by: null };

/**
 * Where playback should be now (seconds): the sent position plus the time since it was sent while
 * playing. A receiver clock behind the sender's (a `sentAt` in the future) counts as no time at all:
 * the reported position is a floor, so skew never pulls a player back towards 0.
 */
export function targetPosition(s: { playing: boolean; position: number; sentAt: number }, now: number): number {
  const elapsed = Math.max(0, now - s.sentAt);
  return Math.max(0, s.position + (s.playing ? elapsed / 1000 : 0));
}

/** True when the local player is more than `thresholdSec` away from the target. */
export function needsCorrection(local: number, target: number, thresholdSec = DRIFT_THRESHOLD_S): boolean {
  return Math.abs(local - target) > thresholdSec;
}

export type MediaAction =
  | { type: 'local'; next: Omit<MediaState, 'lamport'> }
  | { type: 'remote'; msg: Extract<MediaMessage, { t: 'media-state' }>; self?: Role };

type StateMessage = Extract<MediaMessage, { t: 'media-state' }>;

/** Whether a remote state wins over the current one (the order of the reducer). */
function wins(s: MediaState, m: StateMessage, self?: Role): boolean {
  if (m.lamport !== s.lamport) return m.lamport > s.lamport;
  if (m.by === 'teacher' && s.by !== 'teacher') return true;
  // Same person at the same counter: a heartbeat, ordered on that person's clock. My own state sent
  // back to me (a reply at my counter) is stamped on the other clock, so it never wins.
  return m.by === s.by && m.by !== self && m.sentAt > s.sentAt;
}

/**
 * Local actions bump the Lamport counter. A remote state is applied only when its counter is higher;
 * on a tie the teacher wins (as for the stage), and between two states from the same person (a
 * heartbeat) the later `sentAt` wins, unless that person is `self` (see `wins`). Otherwise the current
 * state (same object) is kept: its counter is already max(local, remote).
 */
export function mediaReducer(s: MediaState, a: MediaAction): MediaState {
  if (a.type === 'local') return { ...a.next, lamport: s.lamport + 1 };
  const m = a.msg;
  if (!wins(s, m, a.self)) return s;
  return { source: m.source, playing: m.playing, position: m.position, sentAt: m.sentAt, lamport: Math.max(s.lamport, m.lamport), by: m.by };
}

/**
 * A received state: the next state, and whether to answer the sender with it. A stale state (a lower
 * counter, or one that lost the teacher tie-break) is answered, so someone who reloaded and acted
 * before catching up converges. An equal state, an older heartbeat or my own state sent back is not
 * a conflict and gets no answer, so two people never ping-pong.
 */
export function receiveState(s: MediaState, m: StateMessage, self: Role): { next: MediaState; answer: boolean } {
  const next = mediaReducer(s, { type: 'remote', msg: m, self });
  if (next !== s) return { next, answer: false };
  const stale = m.lamport < s.lamport || (m.lamport === s.lamport && s.by === 'teacher' && m.by !== 'teacher');
  return { next: s, answer: stale && s.by !== null };
}
