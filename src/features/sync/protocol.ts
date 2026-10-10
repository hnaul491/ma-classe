import type { Role } from '@/lib/lessons/types';

export type Stage = 'cameras' | 'board' | 'screen' | 'media';
export const STAGES: readonly Stage[] = ['cameras', 'board', 'screen', 'media'];

export type SyncMessage = { t: 'stage'; stage: Stage; lamport: number; by: Role };

export const PROTOCOL_VERSION = 1;
export const SYNC_TOPIC = 'ma-classe';

export function encode(msg: SyncMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }));
}

function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v);
}

export function decode(data: Uint8Array): SyncMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== PROTOCOL_VERSION) return null;
  if (m.t === 'stage') {
    if (!isStage(m.stage)) return null;
    if (!Number.isInteger(m.lamport) || (m.lamport as number) < 0) return null;
    if (m.by !== 'teacher' && m.by !== 'student') return null;
    return { t: 'stage', stage: m.stage, lamport: m.lamport as number, by: m.by };
  }
  return null;
}
