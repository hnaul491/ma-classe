import { describe, expect, it } from 'vitest';
import { BACKUP_MAX_AGE_MS, parseBackup, prunableBackupKeys, shouldWriteBackup } from './backup';

describe('shouldWriteBackup', () => {
  it('writes only once the scene holds the saved board or the old backup', () => {
    expect(shouldWriteBackup({ loaded: false, backupMerged: false, unsaved: true })).toBe(false); // would replace the backup with less
    expect(shouldWriteBackup({ loaded: true, backupMerged: false, unsaved: true })).toBe(true);
    expect(shouldWriteBackup({ loaded: false, backupMerged: true, unsaved: true })).toBe(true); // failed load, backup merged
    expect(shouldWriteBackup({ loaded: true, backupMerged: true, unsaved: true })).toBe(true);
  });

  it('writes nothing when everything is saved (no orphaned backups)', () => {
    expect(shouldWriteBackup({ loaded: true, backupMerged: false, unsaved: false })).toBe(false);
    expect(shouldWriteBackup({ loaded: true, backupMerged: true, unsaved: false })).toBe(false);
  });

  it('after a failed load, nothing is saved, so the scene is always backed up', () => {
    expect(shouldWriteBackup({ loaded: false, backupMerged: true, unsaved: false })).toBe(true);
  });
});

describe('parseBackup', () => {
  it('returns the elements of a stored scene', () => {
    const el = { id: 'a', version: 3, versionNonce: 9, type: 'rectangle' };
    expect(parseBackup(JSON.stringify({ elements: [el] }))).toEqual([el]);
    expect(parseBackup(JSON.stringify({ elements: [el], savedAt: 5 }))).toEqual([el]);
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

describe('prunableBackupKeys', () => {
  const now = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const backup = (savedAt?: unknown) => JSON.stringify({ elements: [{ id: 'a', version: 1, versionNonce: 1 }], savedAt });

  it('keeps board backups younger than 7 days', () => {
    expect(BACKUP_MAX_AGE_MS).toBe(7 * day);
    expect(prunableBackupKeys([['board-backup:L1', backup(now - 6 * day)]], now)).toEqual([]);
    expect(prunableBackupKeys([['board-backup:L1', backup(now)]], now)).toEqual([]);
  });

  it('prunes board backups older than 7 days, without savedAt, or unreadable', () => {
    const entries: [string, string | null][] = [
      ['board-backup:old', backup(now - 7 * day - 1)],
      ['board-backup:none', backup()],
      ['board-backup:text', backup('yesterday')],
      ['board-backup:garbage', 'not json'],
      ['board-backup:null', null],
      ['board-backup:fresh', backup(now - day)],
    ];
    expect(prunableBackupKeys(entries, now)).toEqual(['board-backup:old', 'board-backup:none', 'board-backup:text', 'board-backup:garbage', 'board-backup:null']);
  });

  it('never touches other keys', () => {
    expect(prunableBackupKeys([['theme', 'dark'], ['locale', null]], now)).toEqual([]);
  });

  it("keeps the given key (this lesson's backup, which the load still reads even without savedAt)", () => {
    const entries: [string, string | null][] = [['board-backup:L1', backup()], ['board-backup:L2', backup()]];
    expect(prunableBackupKeys(entries, now, 'board-backup:L1')).toEqual(['board-backup:L2']);
  });
});
