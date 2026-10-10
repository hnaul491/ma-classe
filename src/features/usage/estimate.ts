/** Free plan limits (spec §4): LiveKit Build per month, Supabase Free file storage. */
export const FREE_LIMITS = { participantMinutes: 5000, downstreamBytes: 50 * 1e9, storageBytes: 1024 ** 3 } as const;
/** 540p camera with simulcast: 1,800 participant-minutes × 0.8 Mbit/s ≈ 11 GB, as spec §4 expects. */
export const BITRATE_MBPS = 0.8;
/** A LiveKit token lasts 4 hours, so no lesson can use more; a lesson left live by mistake counts that much at most. */
export const MAX_LESSON_MS = 4 * 60 * 60 * 1000;
const WARN_AT = 0.7;
const PARTICIPANTS = 2;

export type UsageItem = { key: 'minutes' | 'data' | 'storage'; used: number; limit: number; ratio: number; level: 'ok' | 'warn' | 'over' };
export type Usage = { items: UsageItem[]; warn: boolean };

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

function item(key: UsageItem['key'], used: number, limit: number): UsageItem {
  const ratio = used / limit;
  return { key, used, limit, ratio, level: ratio >= 1 ? 'over' : ratio >= WARN_AT ? 'warn' : 'ok' };
}

export function estimateUsage({
  lessons,
  fileBytes,
  now,
}: {
  lessons: readonly { started_at: string; ended_at: string | null }[];
  fileBytes: readonly number[];
  now: Date;
}): Usage {
  const from = monthStart(now).getTime();
  const to = now.getTime();
  let ms = 0;
  for (const l of lessons) {
    const start = Date.parse(l.started_at);
    if (Number.isNaN(start)) continue;
    const rawEnd = l.ended_at ? Date.parse(l.ended_at) : to;
    if (Number.isNaN(rawEnd)) continue;
    const end = Math.min(rawEnd, start + MAX_LESSON_MS, to);
    const counted = end - Math.max(start, from);
    if (counted > 0) ms += counted;
  }
  const participantMinutes = Math.round((ms / 60000) * PARTICIPANTS);
  const dataBytes = participantMinutes * 60 * ((BITRATE_MBPS * 1e6) / 8);
  const storage = fileBytes.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  const items = [
    item('minutes', participantMinutes, FREE_LIMITS.participantMinutes),
    item('data', dataBytes, FREE_LIMITS.downstreamBytes),
    item('storage', storage, FREE_LIMITS.storageBytes),
  ];
  return { items, warn: items.some((i) => i.level !== 'ok') };
}
