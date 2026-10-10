import { describe, expect, it } from 'vitest';
import { parseBackup } from './backup';

describe('parseBackup', () => {
  it('returns the elements of a stored scene', () => {
    const el = { id: 'a', version: 3, versionNonce: 9, type: 'rectangle' };
    expect(parseBackup(JSON.stringify({ elements: [el] }))).toEqual([el]);
  });

  it('returns null for nothing, garbage, an empty or a malformed scene', () => {
    expect(parseBackup(null)).toBeNull();
    expect(parseBackup('not json')).toBeNull();
    expect(parseBackup('null')).toBeNull();
    expect(parseBackup(JSON.stringify({ elements: 'x' }))).toBeNull();
    expect(parseBackup(JSON.stringify({ elements: [{ id: 'a' }] }))).toBeNull();
    expect(parseBackup(JSON.stringify({ elements: [] }))).toBeNull();
  });
});
