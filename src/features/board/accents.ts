export const ACCENTS = ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'ù', 'û', 'î', 'ï', 'ô', 'œ'] as const;

export function insertAtCursor(value: string, start: number | null, end: number | null, text: string) {
  const clamp = (n: number) => Math.min(Math.max(n, 0), value.length);
  let s = clamp(start ?? end ?? value.length);
  let e = clamp(end ?? start ?? value.length);
  if (e < s) [s, e] = [e, s];
  return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
}

const TEXT_INPUT_TYPES = ['text', 'search', 'url', ''];

export function isTextTarget(el: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.includes(el.type ?? '');
}
