import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const { data: lesson } = await supabase.from('lessons').select('id, title, status').eq('id', id).maybeSingle();
  if (!lesson) notFound();

  if (lesson.status !== 'live') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
        <p className="text-lg">This lesson has ended.</p>
        <Link href="/" className="text-blue underline">
          Back to home
        </Link>
      </main>
    );
  }

  return <main className="p-6">Room for {lesson.title} (Task 10)</main>;
}
