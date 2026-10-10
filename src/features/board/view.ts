export type ViewState = { scrollX: number; scrollY: number; zoom: number; width: number; height: number };

/** Excalidraw: screen = (scene + scroll) * zoom. */
export function viewCenter(v: ViewState): { cx: number; cy: number } {
  return { cx: v.width / 2 / v.zoom - v.scrollX, cy: v.height / 2 / v.zoom - v.scrollY };
}

export function scrollForCenter(
  c: { cx: number; cy: number },
  zoom: number,
  size: { width: number; height: number },
): { scrollX: number; scrollY: number } {
  return { scrollX: size.width / 2 / zoom - c.cx, scrollY: size.height / 2 / zoom - c.cy };
}

export type FollowState = { following: boolean; lastApplied: { scrollX: number; scrollY: number; zoom: number } | null };

const SCROLL_EPS = 1;
const ZOOM_EPS = 0.001;

export function followReducer(
  s: FollowState,
  a:
    | { type: 'applied'; scrollX: number; scrollY: number; zoom: number }
    | { type: 'scrolled'; scrollX: number; scrollY: number; zoom: number }
    | { type: 'resume' },
): FollowState {
  switch (a.type) {
    case 'resume':
      return { following: true, lastApplied: null };
    case 'applied':
      return s.following ? { following: true, lastApplied: { scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom } } : s;
    case 'scrolled': {
      if (!s.following || !s.lastApplied) return s;
      const l = s.lastApplied;
      const same =
        Math.abs(l.scrollX - a.scrollX) <= SCROLL_EPS &&
        Math.abs(l.scrollY - a.scrollY) <= SCROLL_EPS &&
        Math.abs(l.zoom - a.zoom) <= ZOOM_EPS;
      return same ? s : { following: false, lastApplied: null };
    }
  }
}

export function layoutPages(
  sizes: readonly { width: number; height: number }[],
  opts: { x?: number; y?: number; width?: number; gap?: number } = {},
): { x: number; y: number; width: number; height: number }[] {
  const x = opts.x ?? 0;
  const width = opts.width ?? 1000;
  const gap = opts.gap ?? 80;
  let y = opts.y ?? 0;
  return sizes.map((s) => {
    const height = Math.round((s.height * width) / s.width);
    const box = { x, y, width, height };
    y += height + gap;
    return box;
  });
}
