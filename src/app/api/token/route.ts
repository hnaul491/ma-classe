import { NextResponse, type NextRequest } from 'next/server';
import { getMember } from '@/lib/auth/session';
import { livekitEnv } from '@/lib/env';
import { authorizeJoin } from '@/lib/lessons/rules';
import { mintToken } from '@/lib/livekit/token';
import { createClient } from '@/lib/supabase/server';

// Supabase did not answer: 503 tells the client to retry, not "you are not allowed".
const noAnswer = () => NextResponse.json({ error: 'join.noAnswer' }, { status: 503 });

export async function GET(request: NextRequest) {
  const lessonId = request.nextUrl.searchParams.get('lesson');
  let session: Awaited<ReturnType<typeof getMember>>;
  try {
    session = await getMember();
  } catch (err) {
    console.error('[token] getMember failed', err);
    return noAnswer();
  }
  const { user, member } = session;

  let lesson: { status: 'live' | 'ended' } | null = null;
  if (member && lessonId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from('lessons').select('status').eq('id', lessonId).maybeSingle();
    if (error) {
      console.error('[token] lessons query failed', error);
      return noAnswer();
    }
    lesson = data as typeof lesson;
  }

  const check = authorizeJoin({ signedIn: Boolean(user), member, lesson });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status });

  const env = livekitEnv();
  const token = await mintToken({
    apiKey: env.key,
    apiSecret: env.secret,
    identity: member!.email,
    name: member!.display_name,
    room: lessonId!,
  });
  return NextResponse.json({ token, url: env.url });
}
