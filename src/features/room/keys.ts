import type { Stage } from '@/features/sync/protocol';

export function isTypingElement(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export function isUserCancel(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

/** F toggles fullscreen, except on the board stage, where Excalidraw uses F for its frame tool (use the button there). */
export function fullscreenKeyEnabled(stage: Stage): boolean {
  return stage !== 'board';
}
