import { describe, expect, it } from 'vitest';
import { decodeChat, encodeChat, linkify, mergeMessages, prepareMessage, shouldSendOnKey, type ChatMessage } from './model';

const L = '11111111-1111-4111-8111-111111111111';
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: '22222222-2222-4222-8222-222222222222',
  lessonId: L,
  authorEmail: 's@x.fr',
  authorName: 'Luan',
  body: 'Bonjour',
  createdAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

describe('prepareMessage', () => {
  it('trims and accepts normal text', () => {
    expect(prepareMessage('  Salut !  ')).toEqual({ ok: true, body: 'Salut !' });
  });
  it('rejects empty or whitespace-only', () => {
    expect(prepareMessage('   \n ')).toEqual({ ok: false, reason: 'chat.empty' });
  });
  it('rejects over 2000 characters', () => {
    expect(prepareMessage('a'.repeat(2001))).toEqual({ ok: false, reason: 'chat.tooLong' });
    expect(prepareMessage('a'.repeat(2000)).ok).toBe(true);
  });
});

describe('encodeChat / decodeChat', () => {
  it('round-trips without the local status', () => {
    const m = msg({ status: 'sending' });
    expect(decodeChat(encodeChat(m), L)).toEqual(msg({}));
  });
  it('never puts the local status on the wire, even for an unsaved message', () => {
    const wire = JSON.parse(encodeChat(msg({ status: 'unsaved' })));
    expect(wire).toEqual({
      v: 1,
      id: '22222222-2222-4222-8222-222222222222',
      lessonId: L,
      authorEmail: 's@x.fr',
      authorName: 'Luan',
      body: 'Bonjour',
      createdAt: '2026-10-10T10:00:00.000Z',
    });
    expect('status' in wire).toBe(false);
  });
  it('does not copy unknown fields onto the wire', () => {
    const extra = { ...msg({}), secret: 'x' } as ChatMessage;
    expect('secret' in JSON.parse(encodeChat(extra))).toBe(false);
  });
  it('rejects an empty body and a missing field', () => {
    expect(decodeChat(encodeChat(msg({ body: '' })), L)).toBeNull();
    const noName = JSON.parse(encodeChat(msg({})));
    delete noName.authorName;
    expect(decodeChat(JSON.stringify(noName), L)).toBeNull();
    const noTime = JSON.parse(encodeChat(msg({})));
    delete noTime.createdAt;
    expect(decodeChat(JSON.stringify(noTime), L)).toBeNull();
  });
  it('lowercases the id', () => {
    const upper = '22222222-2222-4222-8222-ABCDEFABCDEF';
    expect(decodeChat(encodeChat(msg({ id: upper })), L)?.id).toBe(upper.toLowerCase());
  });
  it('rejects other lessons, bad versions, garbage and oversized bodies', () => {
    expect(decodeChat(encodeChat(msg({ lessonId: '33333333-3333-4333-8333-333333333333' })), L)).toBeNull();
    expect(decodeChat('{"v":2}', L)).toBeNull();
    expect(decodeChat('nope', L)).toBeNull();
    expect(decodeChat(encodeChat(msg({ body: 'a'.repeat(2001) })), L)).toBeNull();
    expect(decodeChat(encodeChat(msg({ id: 'not-a-uuid' })), L)).toBeNull();
  });
});

describe('mergeMessages', () => {
  it('shows a message once when it arrives live and from history', () => {
    const live = msg({ status: 'sending' });
    const saved = msg({ status: 'saved' });
    expect(mergeMessages([live], [saved])).toEqual([saved]);
    expect(mergeMessages([saved], [live])).toEqual([saved]);
  });
  it('sorts by time, then id', () => {
    const a = msg({ id: '22222222-2222-4222-8222-22222222222a', createdAt: '2026-10-10T10:00:02.000Z' });
    const b = msg({ id: '22222222-2222-4222-8222-22222222222b', createdAt: '2026-10-10T10:00:01.000Z' });
    expect(mergeMessages([a], [b]).map((m) => m.id)).toEqual([b.id, a.id]);
  });
  it('sorts by the actual instant, not the string', () => {
    // Same instant written two ways, then a later one with an offset that sorts first as text.
    const a = msg({ id: '22222222-2222-4222-8222-22222222222a', createdAt: '2026-10-10T10:00:00.000Z' });
    const b = msg({ id: '22222222-2222-4222-8222-22222222222b', createdAt: '2026-10-10T10:00:00+00:00' });
    const c = msg({ id: '22222222-2222-4222-8222-22222222222c', createdAt: '2026-10-10T11:30:00+02:00' });
    expect(mergeMessages([c, b], [a]).map((m) => m.id)).toEqual([c.id, a.id, b.id]);
  });
  it('never lets a self-echo (no status) hide a failed save', () => {
    const unsaved = msg({ status: 'unsaved' });
    const echo = msg({});
    expect(mergeMessages([unsaved], [echo])).toEqual([unsaved]);
    expect(mergeMessages([echo], [unsaved])).toEqual([unsaved]);
  });
  it('lets a sending message replace a live one, and saved replace everything', () => {
    const live = msg({});
    const sending = msg({ status: 'sending' });
    const unsaved = msg({ status: 'unsaved' });
    const saved = msg({ status: 'saved' });
    expect(mergeMessages([live], [sending])).toEqual([sending]);
    expect(mergeMessages([unsaved], [saved])).toEqual([saved]);
    expect(mergeMessages([saved], [unsaved])).toEqual([saved]);
  });
});

describe('linkify', () => {
  it('turns http(s) links into link segments and keeps the rest as text', () => {
    expect(linkify('voir https://fr.wikipedia.org/wiki/Passé_composé, merci')).toEqual([
      { kind: 'text', text: 'voir ' },
      { kind: 'link', href: 'https://fr.wikipedia.org/wiki/Passé_composé', text: 'https://fr.wikipedia.org/wiki/Passé_composé' },
      { kind: 'text', text: ', merci' },
    ]);
  });
  it('never treats HTML or other schemes as links', () => {
    expect(linkify('<b>hi</b> javascript:alert(1)')).toEqual([{ kind: 'text', text: '<b>hi</b> javascript:alert(1)' }]);
  });
  it('keeps a closing parenthesis that belongs to the link', () => {
    const url = 'https://en.wikipedia.org/wiki/Paris_(France)';
    expect(linkify(`voir ${url}.`)).toEqual([
      { kind: 'text', text: 'voir ' },
      { kind: 'link', href: url, text: url },
      { kind: 'text', text: '.' },
    ]);
  });
  it('drops a closing parenthesis that wraps the link', () => {
    expect(linkify('(voir https://x.fr/a)')).toEqual([
      { kind: 'text', text: '(voir ' },
      { kind: 'link', href: 'https://x.fr/a', text: 'https://x.fr/a' },
      { kind: 'text', text: ')' },
    ]);
    expect(linkify('(https://en.wikipedia.org/wiki/Paris_(France))')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', href: 'https://en.wikipedia.org/wiki/Paris_(France)', text: 'https://en.wikipedia.org/wiki/Paris_(France)' },
      { kind: 'text', text: ')' },
    ]);
  });
  it('drops French and typographic closing punctuation', () => {
    for (const p of ['»', '…', '。', '’', '.»', '!…']) {
      expect(linkify(`https://x.fr/a${p}`)).toEqual([
        { kind: 'link', href: 'https://x.fr/a', text: 'https://x.fr/a' },
        { kind: 'text', text: p },
      ]);
    }
  });
  it('links two URLs in one message', () => {
    expect(linkify('https://a.fr et http://b.fr/x')).toEqual([
      { kind: 'link', href: 'https://a.fr', text: 'https://a.fr' },
      { kind: 'text', text: ' et ' },
      { kind: 'link', href: 'http://b.fr/x', text: 'http://b.fr/x' },
    ]);
  });
  it('handles a URL that is the whole message', () => {
    expect(linkify('https://x.fr/a')).toEqual([{ kind: 'link', href: 'https://x.fr/a', text: 'https://x.fr/a' }]);
  });
  it('never links a bare scheme', () => {
    expect(linkify('https://')).toEqual([{ kind: 'text', text: 'https://' }]);
    expect(linkify('tape https://. puis')).toEqual([{ kind: 'text', text: 'tape https://. puis' }]);
    expect(linkify('http://)')).toEqual([{ kind: 'text', text: 'http://)' }]);
  });
  it('returns nothing for an empty body', () => {
    expect(linkify('')).toEqual([]);
  });
});

describe('shouldSendOnKey', () => {
  it('sends on Enter, not on Shift+Enter or while composing', () => {
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSendOnKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});
