import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { adminClient } from '@/lib/supabase/admin';

// Supabase pauses free projects after 7 days without activity; one query a day prevents it.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${serverEnv().cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const { error } = await adminClient().from('lessons').select('id', { head: true, count: 'exact' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
