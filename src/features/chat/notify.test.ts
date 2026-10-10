import { describe, expect, it } from 'vitest';
import { chatButtonAction, chatSeen, initialToast, previewText, shouldNotify, titleWithCount, toastReducer } from './notify';

describe('shouldNotify', () => {
  it('only for the other person while the panel is closed', () => {
    expect(shouldNotify({ fromSelf: false, panelOpen: false })).toBe(true);
    expect(shouldNotify({ fromSelf: true, panelOpen: false })).toBe(false);
    expect(shouldNotify({ fromSelf: false, panelOpen: true })).toBe(false);
    expect(shouldNotify({ fromSelf: true, panelOpen: true })).toBe(false);
  });
});

describe('previewText', () => {
  it('collapses whitespace and trims', () => {
    expect(previewText('  hello \n\n  world\t!  ')).toBe('hello world !');
  });
  it('keeps text at the limit', () => {
    expect(previewText('a'.repeat(80))).toBe('a'.repeat(80));
  });
  it('cuts with an ellipsis', () => {
    expect(previewText('a'.repeat(81))).toBe(`${'a'.repeat(80)}…`);
    expect(previewText('abcdef', 3)).toBe('abc…');
  });
  it('never cuts a surrogate pair in half', () => {
    const out = previewText('😀😀😀', 2);
    expect(out).toBe('😀😀…');
    expect(previewText('a😀b', 2)).toBe('a😀…');
  });
});

describe('titleWithCount', () => {
  it('prefixes the count', () => {
    expect(titleWithCount('Ma Classe', 3)).toBe('(3) Ma Classe');
  });
  it('gives the base when nothing is unread', () => {
    expect(titleWithCount('Ma Classe', 0)).toBe('Ma Classe');
    expect(titleWithCount('Ma Classe', -1)).toBe('Ma Classe');
  });
});

describe('toastReducer', () => {
  const a = { name: 'Ana', text: 'one' };
  const b = { name: 'Ben', text: 'two' };
  it('shows the first message with no extras', () => {
    expect(toastReducer(initialToast, { type: 'new', ...a })).toEqual({ latest: a, extra: 0 });
  });
  it('keeps the latest and counts the rest', () => {
    const s = toastReducer(toastReducer(toastReducer(initialToast, { type: 'new', ...a }), { type: 'new', ...b }), { type: 'new', ...a });
    expect(s.latest).toEqual(a);
    expect(s.extra).toBe(2);
  });
  it('dismiss and open clear it', () => {
    const s = toastReducer(initialToast, { type: 'new', ...a });
    expect(toastReducer(s, { type: 'dismiss' })).toEqual(initialToast);
    expect(toastReducer(s, { type: 'open' })).toEqual(initialToast);
  });
});

describe('chatSeen', () => {
  it('is seen only when the chat is open and the tab is in view', () => {
    expect(chatSeen({ open: true, hidden: false })).toBe(true);
    expect(chatSeen({ open: true, hidden: true })).toBe(false);
    expect(chatSeen({ open: false, hidden: false })).toBe(false);
    expect(chatSeen({ open: false, hidden: true })).toBe(false);
  });
  it('the chat counts as seen only while its tab is the one shown', () => {
    expect(chatSeen({ open: true, hidden: false, tab: 'chat' })).toBe(true);
    expect(chatSeen({ open: true, hidden: false, tab: 'vocab' })).toBe(false);
    expect(chatSeen({ open: true, hidden: true, tab: 'chat' })).toBe(false);
    expect(chatSeen({ open: false, hidden: false, tab: 'chat' })).toBe(false);
    expect(chatSeen({ open: true, hidden: false })).toBe(true);
  });
});

describe('chatButtonAction', () => {
  it('shows the chat when messages are unread and the chat is not on screen', () => {
    expect(chatButtonAction({ open: false, tab: 'chat', unread: 2 })).toBe('open-chat');
    expect(chatButtonAction({ open: false, tab: 'vocab', unread: 1 })).toBe('open-chat');
    expect(chatButtonAction({ open: true, tab: 'vocab', unread: 1 })).toBe('open-chat');
  });
  it('toggles the panel when nothing is unread', () => {
    expect(chatButtonAction({ open: false, tab: 'chat', unread: 0 })).toBe('toggle');
    expect(chatButtonAction({ open: false, tab: 'vocab', unread: 0 })).toBe('toggle');
    expect(chatButtonAction({ open: true, tab: 'vocab', unread: 0 })).toBe('toggle');
    expect(chatButtonAction({ open: true, tab: 'chat', unread: 0 })).toBe('toggle');
  });
  it('closes the chat when it is the tab on screen, even with a count left over', () => {
    expect(chatButtonAction({ open: true, tab: 'chat', unread: 3 })).toBe('toggle');
  });
});
