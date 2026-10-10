import { describe, expect, it } from 'vitest';
import { addParam } from './params';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('addParam', () => {
  it('reads a document id from ?add=', () => {
    expect(addParam(`?add=${ID}`)).toBe(ID);
    expect(addParam(`?x=1&add=${ID.toUpperCase()}`)).toBe(ID.toUpperCase());
  });

  it('ignores a missing, empty or malformed id (it goes into a database filter)', () => {
    expect(addParam('')).toBeNull();
    expect(addParam('?add=')).toBeNull();
    expect(addParam('?add=abc')).toBeNull();
    expect(addParam(`?add=${ID},id.neq.x`)).toBeNull();
    expect(addParam(`?add=${ID})`)).toBeNull();
  });
});
