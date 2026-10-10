import type { BoardElement } from './protocol';

/** True when `b` should replace `a` for the same element id: higher version, then lower versionNonce (Excalidraw's rule). */
function wins(b: BoardElement, a: BoardElement): boolean {
  if (b.version !== a.version) return b.version > a.version;
  return b.versionNonce < a.versionNonce;
}

/**
 * Merges two scenes by element id, as `public.merge_board_save` does in SQL (migration 0006):
 * the higher version wins, a version tie goes to the lower versionNonce, a full tie keeps the
 * stored side, and an element present on only one side is kept. Positions follow the first
 * occurrence: stored order first, then elements only the incoming side has.
 */
export function mergeSceneElements(stored: readonly BoardElement[], incoming: readonly BoardElement[]): BoardElement[] {
  const byId = new Map<string, BoardElement>();
  for (const e of [...stored, ...incoming]) {
    const current = byId.get(e.id);
    if (!current || wins(e, current)) byId.set(e.id, e);
  }
  return [...byId.values()];
}

/** The merge function is not there yet (before migration 0006): PostgREST PGRST202, Postgres 42883. */
export function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}
