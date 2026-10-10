import { describe, expect, it } from 'vitest';
import { isTypingElement, isUserCancel } from './keys';

describe('isTypingElement', () => {
  it('treats inputs, textareas, selects and editable elements as typing targets (F must not toggle fullscreen)', () => {
    expect(isTypingElement({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingElement({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('lets F toggle fullscreen everywhere else', () => {
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTypingElement({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingElement(null)).toBe(false);
  });
});

describe('isUserCancel', () => {
  it('recognizes the user closing the screen picker', () => {
    expect(isUserCancel({ name: 'NotAllowedError' })).toBe(true);
    expect(isUserCancel({ name: 'AbortError' })).toBe(true);
    expect(isUserCancel(new Error('boom'))).toBe(false);
    expect(isUserCancel(null)).toBe(false);
  });
});
