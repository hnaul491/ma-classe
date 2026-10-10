import type { BoardElement } from './protocol';

/** Highest version of each element that we have already sent or received. */
export type KnownVersions = Map<string, number>;

export function changedElements(known: KnownVersions, elements: readonly BoardElement[]): BoardElement[] {
  return elements.filter((e) => (known.get(e.id) ?? -1) < e.version);
}

export function markKnown(known: KnownVersions, elements: readonly BoardElement[]): void {
  for (const e of elements) {
    if ((known.get(e.id) ?? -1) < e.version) known.set(e.id, e.version);
  }
}
