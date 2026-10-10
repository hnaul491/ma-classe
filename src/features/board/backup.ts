import { isBoardElement, type BoardElement } from './protocol';

export const BACKUP_PREFIX = 'board-backup:';
/** Backups older than this are dropped on mount (a lesson never lasts a week). */
export const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether pagehide may write a backup. Before the saved board is loaded nothing is saved, so the
 * scene is backed up once it holds the old backup (merged after a failed load) — never with less.
 * Once loaded, only while the save queue has something unsaved, so a saved board leaves no backup.
 */
export function shouldWriteBackup(s: { loaded: boolean; backupMerged: boolean; unsaved: boolean }): boolean {
  if (!s.loaded) return s.backupMerged;
  return s.unsaved;
}

/** Elements from a localStorage board backup, or null when there is none or it is malformed. */
export function parseBackup(raw: string | null): BoardElement[] | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const elements = (o as { elements?: unknown }).elements;
  if (!Array.isArray(elements) || elements.length === 0 || !elements.every(isBoardElement)) return null;
  return elements;
}

/**
 * The board backups to remove: older than BACKUP_MAX_AGE_MS, without a numeric `savedAt`, or
 * unreadable. Other localStorage keys, and `keep` (this lesson's backup), are never returned.
 */
export function prunableBackupKeys(entries: readonly (readonly [string, string | null])[], now: number, keep?: string): string[] {
  const out: string[] = [];
  for (const [key, raw] of entries) {
    if (!key.startsWith(BACKUP_PREFIX) || key === keep) continue;
    if (!(now - savedAtOf(raw) <= BACKUP_MAX_AGE_MS)) out.push(key);
  }
  return out;
}

function savedAtOf(raw: string | null): number {
  if (!raw) return Number.NaN;
  try {
    const savedAt = (JSON.parse(raw) as { savedAt?: unknown } | null)?.savedAt;
    return typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : Number.NaN;
  } catch {
    return Number.NaN;
  }
}
