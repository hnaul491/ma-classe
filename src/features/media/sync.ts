import type { Role } from '@/lib/lessons/types';
import type { MediaMessage, MediaSource } from './protocol';

/** Seconds of drift tolerated before a receiver seeks to match. */
export const DRIFT_THRESHOLD_S = 1;
/** While playing, the person who last acted re-sends the state this often. */
export const HEARTBEAT_MS = 5000;

/** `by`: who acted last (null before anyone did). */
export type MediaState = { source: MediaSource | null; playing: boolean; position: number; sentAt: number; lamport: number; by: Role | null };

export const INITIAL_MEDIA_STATE: MediaState = { source: null, playing: false, position: 0, sentAt: 0, lamport: 0, by: null };

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
 * Local actions bump the Lamport counter. A remote state is applied only when its counter is higher;
 * on a tie the teacher wins (as for the stage), and between two states from the same person (a
 * heartbeat) the later `sentAt` wins. Otherwise the current state (same object) is kept.
 */
export function mediaReducer(s: MediaState, a: MediaAction): MediaState {
  if (a.type === 'local') return { ...a.next, lamport: s.lamport + 1 };
  const m = a.msg;
  const tie = m.lamport === s.lamport;
  const newer =
    m.lamport > s.lamport ||
    (tie && m.by === 'teacher' && s.by !== 'teacher') ||
    (tie && m.by === s.by && m.sentAt > s.sentAt);
  return newer ? { source: m.source, playing: m.playing, position: m.position, sentAt: m.sentAt, lamport: m.lamport, by: m.by } : s;
}
