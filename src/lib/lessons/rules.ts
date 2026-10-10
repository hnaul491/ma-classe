import type { Lesson, Member } from './types';

export function canStartLesson(m: Member | null): boolean {
  return m?.role === 'teacher';
}

export function canEndLesson(m: Member | null): boolean {
  return m?.role === 'teacher';
}

export type JoinCheck =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404 | 409; reason: string };

export function authorizeJoin(input: {
  signedIn: boolean;
  member: Member | null;
  lesson: Pick<Lesson, 'status'> | null;
}): JoinCheck {
  if (!input.signedIn) return { ok: false, status: 401, reason: 'Sign in first.' };
  if (!input.member) return { ok: false, status: 403, reason: 'This classroom is private.' };
  if (!input.lesson) return { ok: false, status: 404, reason: 'This lesson does not exist.' };
  if (input.lesson.status !== 'live') return { ok: false, status: 409, reason: 'This lesson has ended.' };
  return { ok: true };
}
