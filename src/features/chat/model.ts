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

export function encodeChat(m: ChatMessage): string {
  const { status: _status, ...wire } = m;
  return JSON.stringify({ v: 1, ...wire });
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
  return { id: m.id, lessonId, authorEmail: m.authorEmail, authorName: m.authorName, body: m.body, createdAt: m.createdAt };
}

const rank = (s: ChatMessage['status']) => (s === 'saved' ? 2 : s === undefined ? 1 : 0);

export function mergeMessages(a: readonly ChatMessage[], b: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...a, ...b]) {
    const prev = byId.get(m.id);
    if (!prev || rank(m.status) >= rank(prev.status)) byId.set(m.id, m);
  }
  return [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
}

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; href: string; text: string };

const LINK = /https?:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]]+$/;

export function linkify(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    let url = match[0];
    const trail = url.match(TRAILING)?.[0] ?? '';
    url = url.slice(0, url.length - trail.length);
    const start = match.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    out.push({ kind: 'link', href: url, text: url });
    last = start + url.length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  // Merge adjacent text segments (trailing punctuation splits them).
  return out.reduce<Segment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev?.kind === 'text' && s.kind === 'text') prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

export function shouldSendOnKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing;
}
