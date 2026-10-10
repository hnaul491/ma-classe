import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { PLAN_B_URL } from '@/lib/env';
import { getMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { LessonClient } from './LessonClient';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  // getMember throws when Supabase cannot answer; that reaches error.tsx, not the login page.
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const { data: lesson, error } = await supabase.from('lessons').select('id, title, status').eq('id', id).maybeSingle();
  // An outage goes to the error page, not to "not found".
  if (error) throw new Error('Could not load the lesson', { cause: error });
  if (!lesson) notFound();

  if (lesson.status !== 'live') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
        <h1 className="text-2xl font-bold">{t('lesson.ended')}</h1>
        <Link href="/" className="btn btn-secondary">
          {t('lesson.backHome')}
        </Link>
      </main>
    );
  }

  return <LessonClient lessonId={lesson.id} member={member} planBUrl={PLAN_B_URL} />;
}
