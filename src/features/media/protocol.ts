import { AUDIO_MIMES } from '@/features/drive/limits';
import type { Role } from '@/lib/lessons/types';

export const MEDIA_TOPIC = 'ma-classe-media';

export type MediaSource =
  | { kind: 'youtube'; videoId: string; title?: string }
  | { kind: 'audio'; driveId: string; name: string; mimeType: string };

/**
 * - `media-state`: the full playback state after an action (opening a media included), and every 5 s
 *   while playing. `position` is in seconds at `sentAt` (ms, sender clock; the receiver re-stamps it
 *   on arrival, see `stampArrival`). `by` is who acted last: the teacher wins
 *   a Lamport tie, and only that person sends the heartbeat.
 * - `media-req`: a (re)joining person asks for the current state.
 */
export type MediaMessage =
  | { t: 'media-state'; source: MediaSource | null; playing: boolean; position: number; sentAt: number; lamport: number; by: Role }
  | { t: 'media-req' };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Drive file ids use the URL-safe base64 alphabet. */
const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** Titles and names are shown, not trusted: keep packets small. */
const MAX_TEXT = 200;
/** Positions are capped to a day (seconds): no media here is longer. */
export const MAX_POSITION_S = 86_400;

export function encodeMedia(msg: MediaMessage): string {
  return JSON.stringify({ v: 1, ...msg });
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function decodeSource(x: unknown): MediaSource | null {
  if (typeof x !== 'object' || x === null) return null;
  const s = x as Record<string, unknown>;
  if (s.kind === 'youtube') {
    if (typeof s.videoId !== 'string' || !YOUTUBE_ID.test(s.videoId)) return null;
    return typeof s.title === 'string' ? { kind: 'youtube', videoId: s.videoId, title: s.title.slice(0, MAX_TEXT) } : { kind: 'youtube', videoId: s.videoId };
  }
  if (s.kind === 'audio') {
    if (typeof s.driveId !== 'string' || !DRIVE_ID.test(s.driveId)) return null;
    if (typeof s.name !== 'string' || typeof s.mimeType !== 'string' || !AUDIO_MIMES.includes(s.mimeType)) return null;
    return { kind: 'audio', driveId: s.driveId, name: s.name.slice(0, MAX_TEXT), mimeType: s.mimeType };
  }
  return null;
}

export function decodeMedia(text: string): MediaMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== 1) return null;
  switch (m.t) {
    case 'media-state': {
      const source = m.source === null ? null : decodeSource(m.source);
      if (m.source !== null && source === null) return null;
      return typeof m.playing === 'boolean' &&
        finite(m.position) &&
        m.position >= 0 &&
        finite(m.sentAt) &&
        Number.isSafeInteger(m.lamport) &&
        (m.lamport as number) >= 0 &&
        (m.by === 'teacher' || m.by === 'student')
        ? { t: 'media-state', source, playing: m.playing, position: Math.min(m.position, MAX_POSITION_S), sentAt: m.sentAt, lamport: m.lamport as number, by: m.by }
        : null;
    }
    case 'media-req':
      return { t: 'media-req' };
    default:
      return null;
  }
}

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

/**
 * The video id of a YouTube link: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/` or
 * `youtube.com/embed/`, with or without `https://`. Null for anything else (playlist-only, channel,
 * other sites, plain text), and for an id that is not exactly 11 characters of `[A-Za-z0-9_-]`.
 */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = segments.length === 1 ? segments[0] : null;
  } else if (YOUTUBE_HOSTS.includes(host)) {
    if (segments.length === 1 && segments[0] === 'watch') id = url.searchParams.get('v');
    else if (segments.length === 2 && (segments[0] === 'shorts' || segments[0] === 'embed')) id = segments[1];
  }
  // `embed/videoseries?list=…` is a playlist embed: 11 characters, but not a video id.
  return id !== null && id !== 'videoseries' && YOUTUBE_ID.test(id) ? id : null;
}
