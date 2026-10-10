import { NextResponse, type NextRequest } from 'next/server';
import { getMember } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { authorizeJoin } from '@/lib/lessons/rules';
import { mintToken } from '@/lib/livekit/token';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const lessonId = request.nextUrl.searchParams.get('lesson');
  const { user, member } = await getMember();

  let lesson: { status: 'live' | 'ended' } | null = null;
  if (member && lessonId) {
    const supabase = await createClient();
    const { data } = await supabase.from('lessons').select('status').eq('id', lessonId).maybeSingle();
    lesson = data as typeof lesson;
  }

  const check = authorizeJoin({ signedIn: Boolean(user), member, lesson });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status });

  const env = serverEnv();
  const token = await mintToken({
    apiKey: env.livekitKey,
    apiSecret: env.livekitSecret,
    identity: member!.email,
    name: member!.display_name,
    room: lessonId!,
  });
  return NextResponse.json({ token, url: env.livekitUrl });
}
