import type { MessageKey } from '@/lib/i18n/messages';
import type { Lesson, Member } from './types';

export function canStartLesson(m: Member | null): boolean {
  return m?.role === 'teacher';
}

export function canEndLesson(m: Member | null): boolean {
  return m?.role === 'teacher';
}

export type JoinCheck =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404 | 409; reason: MessageKey };

export function authorizeJoin(input: {
  signedIn: boolean;
  member: Member | null;
  lesson: Pick<Lesson, 'status'> | null;
}): JoinCheck {
  if (!input.signedIn) return { ok: false, status: 401, reason: 'join.signInFirst' };
  if (!input.member) return { ok: false, status: 403, reason: 'join.private' };
  if (!input.lesson) return { ok: false, status: 404, reason: 'join.notFound' };
  if (input.lesson.status !== 'live') return { ok: false, status: 409, reason: 'join.ended' };
  return { ok: true };
}
