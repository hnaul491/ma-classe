export const CHAT_TOPIC = 'ma-classe-chat';
export const MAX_CHAT = 2000;

export type ChatMessage = {
  id: string;
  lessonId: string;
  authorEmail: string;
  authorName: string;
  body: string;
  createdAt: string;
  status?: 'sending' | 'saved' | 'unsaved';
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareMessage(raw: string): { ok: true; body: string } | { ok: false; reason: 'chat.empty' | 'chat.tooLong' } {
  const body = raw.trim();
  if (body.length === 0) return { ok: false, reason: 'chat.empty' };
  if (body.length > MAX_CHAT) return { ok: false, reason: 'chat.tooLong' };
  return { ok: true, body };
}

/** Wire form: explicit fields only, so the local status (or anything else) never leaks. */
export function encodeChat(m: ChatMessage): string {
  return JSON.stringify({
    v: 1,
    id: m.id,
    lessonId: m.lessonId,
    authorEmail: m.authorEmail,
    authorName: m.authorName,
    body: m.body,
    createdAt: m.createdAt,
  });
}

export function decodeChat(text: string, lessonId: string): ChatMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  if (m.v !== 1 || m.lessonId !== lessonId) return null;
  if (typeof m.id !== 'string' || !UUID.test(m.id)) return null;
  if (typeof m.authorEmail !== 'string' || typeof m.authorName !== 'string') return null;
  if (typeof m.body !== 'string' || m.body.length < 1 || m.body.length > MAX_CHAT) return null;
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) return null;
  return { id: m.id.toLowerCase(), lessonId, authorEmail: m.authorEmail, authorName: m.authorName, body: m.body, createdAt: m.createdAt };
}

/** No status (a live copy) ranks lowest so an echo never hides a failed save; saved ranks highest. */
const rank = (s: ChatMessage['status']) => (s === 'saved' ? 2 : s === undefined ? 0 : 1);

export function mergeMessages(a: readonly ChatMessage[], b: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...a, ...b]) {
    const prev = byId.get(m.id);
    if (!prev || rank(m.status) >= rank(prev.status)) byId.set(m.id, m);
  }
  return [...byId.values()].sort(
    (x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; href: string; text: string };

const LINK = /https?:\/\/[^\s<>"]+/g;
/** Punctuation that ends the sentence rather than the link. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '»', '…', '。', '’']);
const BARE = /^https?:\/\/$/;

const count = (s: string, ch: string) => s.split(ch).length - 1;

function trimLink(url: string): string {
  while (url.length > 0 && TRAILING.has(url[url.length - 1])) {
    // A ")" that closes a "(" inside the link belongs to it (Wikipedia-style URLs).
    if (url.endsWith(')') && count(url, '(') >= count(url, ')')) break;
    url = url.slice(0, -1);
  }
  return url;
}

export function linkify(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    const url = trimLink(match[0]);
    // "https://" with nothing after it stays text (it is picked up by the next text slice).
    if (BARE.test(url)) continue;
    const start = match.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    out.push({ kind: 'link', href: url, text: url });
    last = start + url.length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** The length counter appears past this many characters. */
export const COUNTER_FROM = 1800;

/** Trimmed length to show in the counter, or null while the message is comfortably short. */
export function charCount(raw: string): number | null {
  const n = raw.trim().length;
  return n > COUNTER_FROM ? n : null;
}

/** HH:mm for a message, or '' for a date that cannot be parsed (never throws). */
export function formatChatTime(iso: string, fmt: Intl.DateTimeFormat): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : fmt.format(t);
}

export type HistoryState = 'loading' | 'ready' | 'failed';

/** Once history has loaded, a failed reload (after a reconnect) keeps it: the list is still the history. */
export function nextHistoryState(prev: HistoryState, ok: boolean): HistoryState {
  return ok || prev === 'ready' ? 'ready' : 'failed';
}

/** Safari fires the Enter that commits an IME composition with isComposing false but keyCode 229. */
const IME_KEYCODE = 229;

export function shouldSendOnKey(e: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== IME_KEYCODE;
}
