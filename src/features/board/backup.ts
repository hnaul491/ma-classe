import { isBoardElement, type BoardElement } from './protocol';

/** Elements from a localStorage board backup, or null when there is none or it is malformed. */
export function parseBackup(raw: string | null): BoardElement[] | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const elements = (o as { elements?: unknown }).elements;
  if (!Array.isArray(elements) || elements.length === 0 || !elements.every(isBoardElement)) return null;
  return elements;
}
