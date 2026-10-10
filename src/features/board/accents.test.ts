import { describe, expect, it } from 'vitest';
import { ACCENTS, insertAtCursor, isTextTarget } from './accents';

describe('insertAtCursor', () => {
  it('inserts at the caret', () => {
    expect(insertAtCursor('ecole', 0, 0, 'é')).toEqual({ value: 'éecole', caret: 1 });
    expect(insertAtCursor('frre', 2, 2, 'è')).toEqual({ value: 'frère', caret: 3 });
  });

  it('replaces a selection', () => {
    expect(insertAtCursor('garcon', 3, 4, 'ç')).toEqual({ value: 'garçon', caret: 4 });
  });

it('swaps a reversed range and clamps out-of-range values', () => {    expect(insertAtCursor('garcon', 4, 3, 'ç')).toEqual({ value: 'garçon', caret: 4 });    expect(insertAtCursor('abc', -5, 99, 'é')).toEqual({ value: 'é', caret: 1 });    expect(insertAtCursor('abc', 99, 99, 'é')).toEqual({ value: 'abcé', caret: 4 });  });  it('treats a missing start as the end', () => {    expect(insertAtCursor('abc', null, 1, 'é')).toEqual({ value: 'aébc', caret: 2 });  });
  it('appends when the caret is unknown', () => {
    expect(insertAtCursor('cafe', null, null, 'é')).toEqual({ value: 'cafeé', caret: 5 });
  });
});

describe('isTextTarget', () => {
  it('accepts textareas, text inputs and editable elements only', () => {
    expect(isTextTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextTarget({ tagName: 'INPUT', type: 'email' })).toBe(false);
    expect(isTextTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextTarget(null)).toBe(false);
  });
});

it('has the 13 French accents from the spec', () => {
  expect(ACCENTS.join('')).toBe('éèêëàâçùûîïôœ');
});
