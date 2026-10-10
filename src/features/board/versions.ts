import type { BoardElement } from './protocol';

/** Highest version of each element that we have already sent or received. */
export type KnownVersions = Map<string, number>;

export function changedElements(known: KnownVersions, elements: readonly BoardElement[]): BoardElement[] {
  return elements.filter((e) => (known.get(e.id) ?? -1) < e.version);
}

/** Remote elements that won the merge: the merged element with the same id has the same version and nonce. */
export function adoptedElements<E extends Pick<BoardElement, 'id' | 'version' | 'versionNonce'>>(
  merged: readonly Pick<BoardElement, 'id' | 'version' | 'versionNonce'>[],
  remote: readonly E[],
): E[] {
  const byId = new Map(merged.map((m) => [m.id, m]));
  return remote.filter((r) => {
    const m = byId.get(r.id);
    return m !== undefined && m.version === r.version && m.versionNonce === r.versionNonce;
  });
}

export function markKnown(known: KnownVersions, elements: readonly BoardElement[]): void {
  for (const e of elements) {
    if ((known.get(e.id) ?? -1) < e.version) known.set(e.id, e.version);
  }
}
