import { describe, expect, it } from 'vitest';
import { authorizeJoin, canEndLesson, canStartLesson } from './rules';
import type { Member } from './types';

const teacher: Member = { email: 't@x.fr', role: 'teacher', display_name: 'Teacher' };
const student: Member = { email: 's@x.fr', role: 'student', display_name: 'Student' };

describe('canStartLesson / canEndLesson', () => {
  it('allows only the teacher', () => {
    expect(canStartLesson(teacher)).toBe(true);
    expect(canStartLesson(student)).toBe(false);
    expect(canStartLesson(null)).toBe(false);
    expect(canEndLesson(teacher)).toBe(true);
    expect(canEndLesson(student)).toBe(false);
  });
});

describe('authorizeJoin', () => {
  it('rejects a visitor who is not signed in', () => {
    expect(authorizeJoin({ signedIn: false, member: null, lesson: null })).toEqual({
      ok: false,
      status: 401,
      reason: 'join.signInFirst',
    });
  });

  it('rejects a signed-in non-member', () => {
    expect(authorizeJoin({ signedIn: true, member: null, lesson: { status: 'live' } })).toEqual({
      ok: false,
      status: 403,
      reason: 'join.private',
    });
  });

  it('rejects a lesson that does not exist', () => {
    expect(authorizeJoin({ signedIn: true, member: student, lesson: null })).toEqual({
      ok: false,
      status: 404,
      reason: 'join.notFound',
    });
  });

  it('rejects joining a lesson that has ended', () => {
    expect(authorizeJoin({ signedIn: true, member: student, lesson: { status: 'ended' } })).toEqual({
      ok: false,
      status: 409,
      reason: 'join.ended',
    });
  });

  it('lets either member join a live lesson, including after a page reload', () => {
    expect(authorizeJoin({ signedIn: true, member: student, lesson: { status: 'live' } })).toEqual({ ok: true });
    expect(authorizeJoin({ signedIn: true, member: teacher, lesson: { status: 'live' } })).toEqual({ ok: true });
  });
});
