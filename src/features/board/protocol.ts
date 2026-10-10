export const BOARD_TOPIC = 'ma-classe-board';
export const SCENE_TOPIC = 'ma-classe-board-scene';
/** Reliable LiveKit packets must stay under ~15 KB; above this we use a text stream. */
export const PACKET_LIMIT = 14000;

export type BoardElement = { id: string; version: number; versionNonce: number; isDeleted?: boolean; [k: string]: unknown };

export type BoardMessage =
  | { t: 'elements'; elements: BoardElement[] }
  | { t: 'scene-req' }
  | { t: 'file'; fileId: string; path: string; mime: string; width: number; height: number }
  | { t: 'viewport'; cx: number; cy: number; zoom: number }
  | { t: 'pointer'; x: number; y: number; tool: 'pointer' | 'laser'; button: 'up' | 'down' };

const IMAGE_MIMES = ['image/webp', 'image/png', 'image/jpeg'];

export function encodeBoard(msg: BoardMessage): string {
  return JSON.stringify({ v: 1, ...msg });
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function isElement(e: unknown): e is BoardElement {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.id === 'string' && Number.isInteger(o.version) && Number.isInteger(o.versionNonce);
}

export function decodeBoard(text: string): BoardMessage | null {
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
    case 'elements':
      return Array.isArray(m.elements) && m.elements.every(isElement) ? { t: 'elements', elements: m.elements } : null;
    case 'scene-req':
      return { t: 'scene-req' };
    case 'file':
      return typeof m.fileId === 'string' &&
        typeof m.path === 'string' &&
        typeof m.mime === 'string' &&
        IMAGE_MIMES.includes(m.mime) &&
        finite(m.width) &&
        finite(m.height)
        ? { t: 'file', fileId: m.fileId, path: m.path, mime: m.mime, width: m.width, height: m.height }
        : null;
    case 'viewport':
      return finite(m.cx) && finite(m.cy) && finite(m.zoom) && m.zoom > 0
        ? { t: 'viewport', cx: m.cx, cy: m.cy, zoom: m.zoom }
        : null;
    case 'pointer':
      return finite(m.x) && finite(m.y) && (m.tool === 'pointer' || m.tool === 'laser') && (m.button === 'up' || m.button === 'down')
        ? { t: 'pointer', x: m.x, y: m.y, tool: m.tool, button: m.button }
        : null;
    default:
      return null;
  }
}

export function fitsInPacket(json: string): boolean {
  return new TextEncoder().encode(json).length <= PACKET_LIMIT;
}
