/** Pure rules for new-message notifications: who gets told, what the preview says, and the toast queue. */

export function shouldNotify({ fromSelf, panelOpen }: { fromSelf: boolean; panelOpen: boolean }): boolean {
  return !fromSelf && !panelOpen;
}

/** One line of the message, at most `max` characters (code points) plus "…" when cut. */
export function previewText(body: string, max = 80): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  // Array.from splits on code points, so an emoji is never cut between its two UTF-16 halves.
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
}

export function titleWithCount(base: string, n: number): string {
  return n > 0 ? `(${n}) ${base}` : base;
}

export type ToastState = { latest: { name: string; text: string } | null; extra: number };
export type ToastAction = { type: 'new'; name: string; text: string } | { type: 'dismiss' } | { type: 'open' };

export const initialToast: ToastState = { latest: null, extra: 0 };

export function toastReducer(s: ToastState, a: ToastAction): ToastState {
  switch (a.type) {
    case 'new':
      return { latest: { name: a.name, text: a.text }, extra: s.latest ? s.extra + 1 : 0 };
    case 'dismiss':
    case 'open':
      return initialToast;
  }
}

/** The chat counts as read only while the side panel is open on its Chat tab and the browser tab is in view. */
export function chatSeen({ open, hidden, tab = 'chat' }: { open: boolean; hidden: boolean; tab?: 'chat' | 'vocab' }): boolean {
  return open && !hidden && tab === 'chat';
}
