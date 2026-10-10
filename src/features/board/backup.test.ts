import { describe, expect, it } from 'vitest';
import { parseBackup, shouldWriteBackup } from './backup';

describe('shouldWriteBackup', () => {
  it('writes only once the scene holds the saved board or the old backup', () => {
    expect(shouldWriteBackup({ loaded: false, backupMerged: false })).toBe(false); // would replace the backup with less
    expect(shouldWriteBackup({ loaded: true, backupMerged: false })).toBe(true);
    expect(shouldWriteBackup({ loaded: false, backupMerged: true })).toBe(true); // failed load, backup merged
    expect(shouldWriteBackup({ loaded: true, backupMerged: true })).toBe(true);
  });
});

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
