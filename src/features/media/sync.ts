import type { MediaMessage, MediaSource } from './protocol';

/** Seconds of drift tolerated before a receiver seeks to match. */
export const DRIFT_THRESHOLD_S = 1;
/** While playing, the person who last acted re-sends the state this often. */
export const HEARTBEAT_MS = 5000;

export type MediaState = { source: MediaSource | null; playing: boolean; position: number; sentAt: number; lamport: number };

export const INITIAL_MEDIA_STATE: MediaState = { source: null, playing: false, position: 0, sentAt: 0, lamport: 0 };

/** Where playback should be now (seconds): the sent position plus the time since it was sent while playing. */
export function targetPosition(s: { playing: boolean; position: number; sentAt: number }, now: number): number {
  return Math.max(0, s.position + (s.playing ? (now - s.sentAt) / 1000 : 0));
}

/** True when the local player is more than `thresholdSec` away from the target. */
export function needsCorrection(local: number, target: number, thresholdSec = DRIFT_THRESHOLD_S): boolean {
  return Math.abs(local - target) > thresholdSec;
}

export type MediaAction =
  | { type: 'local'; next: Omit<MediaState, 'lamport'> }
  | { type: 'remote'; msg: Extract<MediaMessage, { t: 'media-state' }> };

/**
 * Local actions bump the Lamport counter. A remote state is applied only when its counter is higher,
 * or equal with a later `sentAt`; otherwise the current state (same object) is kept.
 */
export function mediaReducer(s: MediaState, a: MediaAction): MediaState {
  if (a.type === 'local') return { ...a.next, lamport: s.lamport + 1 };
  const m = a.msg;
  const newer = m.lamport > s.lamport || (m.lamport === s.lamport && m.sentAt > s.sentAt);
  return newer ? { source: m.source, playing: m.playing, position: m.position, sentAt: m.sentAt, lamport: m.lamport } : s;
}
