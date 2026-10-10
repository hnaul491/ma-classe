export type PageEntry = { index: number; isIntersecting: boolean; intersectionRatio: number };

/** The page in the viewer's reading band: of the pages entering it, the one with the most overlap. */
export function currentPageFrom(entries: readonly PageEntry[]): number | null {
  let best: PageEntry | null = null;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
  }
  return best ? best.index : null;
}
