import { describe, expect, it } from 'vitest';
import { decodeMedia, encodeMedia, MEDIA_TOPIC, type MediaMessage, type MediaSource, parseYouTubeId } from './protocol';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeId', () => {
  it('reads watch?v= URLs, with or without scheme, www or m.', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`http://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('ignores extra parameters (time, playlist, share id)', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/watch?list=PL123&v=${ID}&index=2`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/watch?feature=share&v=${ID}`)).toBe(ID);
  });

  it('reads youtu.be short links', () => {
    expect(parseYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`youtu.be/${ID}?si=abc&t=10`)).toBe(ID);
  });

  it('reads shorts and embed URLs', () => {
    expect(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtube.com/shorts/${ID}?feature=share`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}?start=5`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}/`)).toBe(ID);
  });

  it('trims surrounding spaces', () => {
    expect(parseYouTubeId(`  https://youtu.be/${ID}\n`)).toBe(ID);
  });

  it('rejects playlist-only and channel URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/@FrenchWithVincent')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/channel/UCVHFbqXqoYvEWM1Ddxl0QDg')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/c/Learnfrenchwithalexa')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch')).toBeNull();
  });

  it('rejects ids that are not exactly 11 characters of [A-Za-z0-9_-]', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXc')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQQ')).toBeNull();
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgX!Q')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ%22')).toBeNull();
  });

  it('rejects a playlist embed (videoseries is 11 characters but not a video)', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toBeNull();
    expect(parseYouTubeId('https://www.youtube-nocookie.com/embed/videoseries?list=PL123')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/shorts/videoseries')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=videoseries')).toBeNull();
  });

  it('rejects other sites, other schemes and random text', () => {
    expect(parseYouTubeId(`https://vimeo.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeId(`https://evil.com/youtu.be/${ID}`)).toBeNull();
    expect(parseYouTubeId(`https://youtube.com.evil.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeId(`javascript:alert(1)//youtu.be/${ID}`)).toBeNull();
    expect(parseYouTubeId(`ftp://youtu.be/${ID}`)).toBeNull();
    expect(parseYouTubeId(ID)).toBeNull();
    expect(parseYouTubeId('regarde cette vidéo')).toBeNull();
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('http://')).toBeNull();
  });
});

const yt: MediaSource = { kind: 'youtube', videoId: ID, title: 'Les couleurs' };
const audio: MediaSource = { kind: 'audio', driveId: '1AbC_d-EfG', name: 'Dialogue 3.mp3', mimeType: 'audio/mpeg' };

describe('encodeMedia / decodeMedia', () => {
  it('uses its own topic', () => {
    expect(MEDIA_TOPIC).toBe('ma-classe-media');
  });

  it('round-trips every message', () => {
    const msgs: MediaMessage[] = [
      { t: 'media-state', source: audio, playing: false, position: 0, sentAt: 1, lamport: 1, by: 'teacher' },
      { t: 'media-state', source: yt, playing: true, position: 12.5, sentAt: 1_700_000_000_000, lamport: 3, by: 'teacher' },
      { t: 'media-state', source: null, playing: false, position: 0, sentAt: 5, lamport: 0, by: 'student' },
      { t: 'media-req' },
    ];
    for (const m of msgs) expect(decodeMedia(encodeMedia(m))).toEqual(m);
  });

  it('is versioned', () => {
    expect(JSON.parse(encodeMedia({ t: 'media-req' }))).toEqual({ v: 1, t: 'media-req' });
    expect(decodeMedia('{"v":2,"t":"media-req"}')).toBeNull();
    expect(decodeMedia('{"t":"media-req"}')).toBeNull();
  });

  it('ignores garbage and unknown messages', () => {
    for (const text of ['', 'not json', 'null', '42', '"media-req"', '[]', '{"v":1}', '{"v":1,"t":"media-play"}']) {
      expect(decodeMedia(text)).toBeNull();
    }
  });

  const state = (o: Record<string, unknown>) => JSON.stringify({ v: 1, t: 'media-state', source: yt, playing: true, position: 1, sentAt: 1, lamport: 1, by: 'student', ...o });

  it('rejects a bad YouTube id', () => {
    for (const videoId of ['short', 'dQw4w9WgXcQQ', 'dQw4w9WgX"Q', 42, undefined]) {
      expect(decodeMedia(state({ source: { kind: 'youtube', videoId } }))).toBeNull();
    }
  });

  it('rejects an audio mime outside the allowed types, or a bad Drive id', () => {
    expect(decodeMedia(state({ source: { ...audio, mimeType: 'video/mp4' } }))).toBeNull();
    expect(decodeMedia(state({ source: { ...audio, mimeType: 'text/html' } }))).toBeNull();
    expect(decodeMedia(state({ source: { ...audio, driveId: '' } }))).toBeNull();
    expect(decodeMedia(state({ source: { ...audio, driveId: '../files/x' } }))).toBeNull();
    expect(decodeMedia(state({ source: { ...audio, name: 3 } }))).toBeNull();
  });

  it('rejects an unknown source kind', () => {
    expect(decodeMedia(state({ source: { kind: 'vimeo', videoId: ID } }))).toBeNull();
    expect(decodeMedia(state({ source: 'youtube' }))).toBeNull();
  });

  it('needs a finite, non-negative position', () => {
    expect(decodeMedia(state({ position: -1 }))).toBeNull();
    expect(decodeMedia(state({ position: '3' }))).toBeNull();
    expect(decodeMedia(state({ position: null }))).toBeNull();
    // JSON has no NaN; 1e999 parses to Infinity.
    expect(decodeMedia(state({}).replace('"position":1', '"position":1e999'))).toBeNull();
    expect(decodeMedia(state({ position: 0 }))).not.toBeNull();
  });

  it('needs a boolean playing, a finite sentAt and a non-negative integer lamport', () => {
    expect(decodeMedia(state({ playing: 'yes' }))).toBeNull();
    expect(decodeMedia(state({ sentAt: '1' }))).toBeNull();
    expect(decodeMedia(state({ lamport: -1 }))).toBeNull();
    expect(decodeMedia(state({ lamport: 1.5 }))).toBeNull();
  });

  it('needs who acted (teacher or student), for the tie-break', () => {
    expect(decodeMedia(state({ by: undefined }))).toBeNull();
    expect(decodeMedia(state({ by: 'admin' }))).toBeNull();
    expect(decodeMedia(state({ by: 'teacher' }))).toMatchObject({ by: 'teacher' });
  });

  it('media-load is no longer a message (nothing read it)', () => {
    expect(decodeMedia(JSON.stringify({ v: 1, t: 'media-load', source: yt, at: 1 }))).toBeNull();
  });

  it('needs a safe integer lamport', () => {
    expect(decodeMedia(state({ lamport: Number.MAX_SAFE_INTEGER }))).not.toBeNull();
    expect(decodeMedia(state({}).replace('"lamport":1', '"lamport":9007199254740993'))).toBeNull();
    expect(decodeMedia(state({}).replace('"lamport":1', '"lamport":1e300'))).toBeNull();
  });

  it('caps the position to a day (86400 s)', () => {
    expect(decodeMedia(state({ position: 86400 }))).toMatchObject({ position: 86400 });
    expect(decodeMedia(state({ position: 1e12 }))).toMatchObject({ position: 86400 });
  });

  it('keeps only known fields, drops a non-string title and shortens a long one', () => {
    const extra = decodeMedia(state({ evil: true, source: { ...yt, extra: 1 } }));
    expect(extra).toEqual({ t: 'media-state', source: yt, playing: true, position: 1, sentAt: 1, lamport: 1, by: 'student' });
    expect(decodeMedia(state({ source: { kind: 'youtube', videoId: ID, title: 5 } }))).toMatchObject({ source: { kind: 'youtube', videoId: ID } });
    const long = decodeMedia(state({ source: { kind: 'youtube', videoId: ID, title: 'x'.repeat(1000) } }));
    expect(long?.t === 'media-state' && long.source?.kind === 'youtube' && long.source.title?.length).toBe(200);
  });
});
