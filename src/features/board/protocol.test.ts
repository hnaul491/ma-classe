import { describe, expect, it } from 'vitest';
import { decodeBoard, encodeBoard, fitsInPacket, PACKET_LIMIT, type BoardMessage } from './protocol';

const el = { id: 'a', version: 2, versionNonce: 7, type: 'rectangle' };

describe('board protocol', () => {
  it('round-trips each message type', () => {
    const msgs: BoardMessage[] = [
      { t: 'elements', elements: [el] },
      { t: 'scene-req' },
      { t: 'viewport-req' },
      { t: 'file', fileId: 'f1', path: 'l/f1.webp', mime: 'image/webp', width: 800, height: 600 },
      { t: 'viewport', cx: 10.5, cy: -4, zoom: 1.25 },
      { t: 'pointer', x: 1, y: 2, tool: 'laser', button: 'down' },
    ];
    for (const m of msgs) expect(decodeBoard(encodeBoard(m))).toEqual(m);
  });

  it('ignores other versions, garbage and malformed fields without throwing', () => {
    expect(decodeBoard('{"v":2,"t":"scene-req"}')).toBeNull();
    expect(decodeBoard('not json')).toBeNull();
    expect(decodeBoard('null')).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'elements', elements: [{ id: 'a' }] }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'viewport', cx: 'x', cy: 0, zoom: 1 }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'viewport', cx: 0, cy: 0, zoom: 0 }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'pointer', x: 0, y: 0, tool: 'pen', button: 'up' }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'file', fileId: 'f', path: 'p', mime: 'text/html', width: 1, height: 1 }))).toBeNull();
    expect(decodeBoard(JSON.stringify({ v: 1, t: 'nope' }))).toBeNull();
  });

  it('decides packet vs stream by encoded size', () => {
    expect(fitsInPacket('x'.repeat(PACKET_LIMIT))).toBe(true);
    expect(fitsInPacket('x'.repeat(PACKET_LIMIT + 1))).toBe(false);
    expect(fitsInPacket('é'.repeat(PACKET_LIMIT / 2 + 1))).toBe(false); // counts UTF-8 bytes, not characters
  });
});

describe('viewport zoom from the peer', () => {
  it('is clamped to 0.1–30, like Excalidraw', () => {
    const zoomOf = (zoom: number) => {
      const m = decodeBoard(JSON.stringify({ v: 1, t: 'viewport', cx: 0, cy: 0, zoom }));
      return m?.t === 'viewport' ? m.zoom : null;
    };
    expect(zoomOf(1e9)).toBe(30);
    expect(zoomOf(30)).toBe(30);
    expect(zoomOf(0.01)).toBe(0.1);
    expect(zoomOf(1.5)).toBe(1.5);
    expect(zoomOf(-1)).toBeNull();
  });
});
