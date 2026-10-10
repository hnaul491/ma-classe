export type Role = 'teacher' | 'student';

export interface Member {
  email: string;
  role: Role;
  display_name: string;
}

export interface Lesson {
  id: string;
  title: string;
  status: 'live' | 'ended';
  started_at: string;
  ended_at: string | null;
}
