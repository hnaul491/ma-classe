import type { Role } from '@/lib/lessons/types';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isRole(v: unknown): v is Role {
  return v === 'teacher' || v === 'student';
}
