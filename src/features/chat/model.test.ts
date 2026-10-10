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
    const { status: _status, ...wire } = m;
    expect(decodeChat(encodeChat(m), L)).toEqual(wire);
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
});

describe('shouldSendOnKey', () => {
  it('sends on Enter, not on Shift+Enter or while composing', () => {
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSendOnKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});
