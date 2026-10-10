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
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const { data: lesson } = await supabase.from('lessons').select('id, title, status').eq('id', id).maybeSingle();
  if (!lesson) notFound();

  if (lesson.status !== 'live') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
        <p className="text-lg">{t('lesson.ended')}</p>
        <Link href="/" className="text-blue underline">
          {t('lesson.backHome')}
        </Link>
      </main>
    );
  }

  return <LessonClient lessonId={lesson.id} member={member} planBUrl={PLAN_B_URL} />;
}
