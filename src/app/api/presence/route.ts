import { NextResponse, type NextRequest } from 'next/server';
import { getMember } from '@/lib/auth/session';
import { listIdentities } from '@/lib/livekit/server';
import { createClient } from '@/lib/supabase/server';

// Supabase did not answer: 503 so the client keeps its last known value.
const noAnswer = () => NextResponse.json({ error: 'join.noAnswer' }, { status: 503 });

export async function GET(request: NextRequest) {
  const lessonId = request.nextUrl.searchParams.get('lesson');
  let member;
  try {
    ({ member } = await getMember());
  } catch (err) {
    console.error('[presence] getMember failed', err);
    return noAnswer();
  }
  if (!member || !lessonId) return NextResponse.json({ error: 'This classroom is private.' }, { status: 403 });

  const identities = await listIdentities(lessonId);
  const supabase = await createClient();
  const { data, error } = await supabase.from('members').select('email, role');
  if (error) {
    console.error('[presence] members query failed', error);
    return noAnswer();
  }
  const roleOf = new Map((data ?? []).map((m) => [m.email as string, m.role as string]));
  const roles = identities.map((id) => roleOf.get(id));
  return NextResponse.json({ teacher: roles.includes('teacher'), student: roles.includes('student') });
}
