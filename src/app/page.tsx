import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { getMember } from '@/lib/auth/session';
import { formatLessonDate } from '@/lib/i18n/messages';
import { getLocale, getT, getTimeZone } from '@/lib/i18n/server';
import type { Lesson } from '@/lib/lessons/types';
import { createClient } from '@/lib/supabase/server';
import { startLesson } from './actions';
import { LivePoller } from './LivePoller';

function minutesBetween(a: string, b: string | null): number | null {
  if (!b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getT();
  const timeZone = await getTimeZone();
  // getMember throws when Supabase cannot answer; that reaches error.tsx, not the login page.
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lessons')
    .select('id, title, status, started_at, ended_at')
    .order('started_at', { ascending: false })
    .limit(50);
  // An outage goes to the error page, not to an empty "No lessons yet."
  if (error) throw new Error('Could not load lessons', { cause: error });
  const lessons = (data ?? []) as Lesson[];
  const live = lessons.find((l) => l.status === 'live') ?? null;
  const past = lessons.filter((l) => l.status === 'ended');

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Ma Classe</h1>
        <div className="flex items-center gap-3">
          <LanguageSwitch />
          <span className="rounded bg-surface-2 px-2 py-1 text-xs uppercase tracking-wide text-muted">
            {t(member.role === 'teacher' ? 'role.teacher' : 'role.student')}
          </span>
        </div>
      </header>

      {sp.ended && <p role="status" className="rounded-lg bg-good-soft px-4 py-3 text-good">{t('home.ended')}</p>}

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        {live ? (
          <>
            <p className="font-semibold">{t('home.inProgress', { title: t('lesson.title', { date: formatLessonDate(live.started_at, locale, timeZone) }) })}</p>
            <Link href={`/lesson/${live.id}`} className="self-start rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface">
              {t('home.joinLesson')}
            </Link>
          </>
        ) : member.role === 'teacher' ? (
          <form action={startLesson}>
            <button type="submit" className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface">
              {t('home.startLesson')}
            </button>
          </form>
        ) : (
          <>
            <p className="text-muted">{t('home.waiting')}</p>
            <LivePoller />
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('home.pastLessons')}</h2>
        {past.length === 0 && <p className="text-muted">{t('home.noLessons')}</p>}
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {past.map((l) => (
            <li key={l.id} className="flex justify-between gap-4 px-4 py-3">
              <span>{t('lesson.title', { date: formatLessonDate(l.started_at, locale, timeZone) })}</span>
              <span className="text-sm tabular-nums text-muted">{t('home.minutes', { n: minutesBetween(l.started_at, l.ended_at) ?? '–' })}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
