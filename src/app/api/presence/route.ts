import { NextResponse, type NextRequest } from 'next/server';
import { getMember } from '@/lib/auth/session';
import { listIdentities } from '@/lib/livekit/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const lessonId = request.nextUrl.searchParams.get('lesson');
  const { member } = await getMember();
  if (!member || !lessonId) return NextResponse.json({ error: 'This classroom is private.' }, { status: 403 });

  const identities = await listIdentities(lessonId);
  const supabase = await createClient();
  const { data } = await supabase.from('members').select('email, role');
  const roleOf = new Map((data ?? []).map((m) => [m.email as string, m.role as string]));
  const roles = identities.map((id) => roleOf.get(id));
  return NextResponse.json({ teacher: roles.includes('teacher'), student: roles.includes('student') });
}
