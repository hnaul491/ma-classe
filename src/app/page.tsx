import Link from 'next/link';
import { redirect } from 'next/navigation';
import { estimateUsage, monthStart } from '@/features/usage/estimate';
import { UsageMeter } from '@/features/usage/UsageMeter';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { getMember } from '@/lib/auth/session';
import { formatLessonDate } from '@/lib/i18n/messages';
import { getLocale, getT, getThemePref, getTimeZone } from '@/lib/i18n/server';
import { minutesBetween } from '@/lib/lessons/duration';
import type { Lesson } from '@/lib/lessons/types';
import { createClient } from '@/lib/supabase/server';
import { startLesson } from './actions';
import { LivePoller } from './LivePoller';

export default async function Home({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getT();
  const timeZone = await getTimeZone();
  const theme = await getThemePref();
  // getMember throws when Supabase cannot answer; that reaches error.tsx, not the login page.
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const now = new Date();
  const since = monthStart(now).toISOString();
  const [{ data, error }, usageLessons, usageFiles] = await Promise.all([
    supabase.from('lessons').select('id, title, status, started_at, ended_at').order('started_at', { ascending: false }).limit(50),
    supabase.from('lessons').select('started_at, ended_at').or(`ended_at.is.null,ended_at.gte.${since}`),
    supabase.from('files').select('size_bytes'),
  ]);
  // An outage goes to the error page, not to an empty "No lessons yet."
  if (error) throw new Error('Could not load lessons', { cause: error });
  const lessons = (data ?? []) as Lesson[];
  const live = lessons.find((l) => l.status === 'live') ?? null;
  const past = lessons.filter((l) => l.status === 'ended');

  // The meter is secondary: a failed load shows a note instead of breaking the page.
  const usage =
    usageLessons.error || usageFiles.error
      ? null
      : estimateUsage({
          lessons: usageLessons.data ?? [],
          fileBytes: (usageFiles.data ?? []).map((f) => Number(f.size_bytes)),
          now,
        });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1>
          <Wordmark />
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-muted">
            {t(member.role === 'teacher' ? 'role.teacher' : 'role.student')}
          </span>
          <Link href="/documents" className="btn btn-secondary btn-sm">
            {t('documents.title')}
          </Link>
          <Link href="/vocab" className="btn btn-secondary btn-sm">
            {t('vocab.title')}
          </Link>
          <ThemeSwitch initial={theme} />
          <LanguageSwitch />
        </div>
      </header>

      {member.role === 'teacher' && (
        // A personal note from the student, always in French.
        <p lang="fr" className="rounded-xl border-l-4 border-pen bg-pen-soft px-5 py-4 font-display text-lg font-medium text-ink">
          J’apprécie vraiment vos efforts. Merci infiniment !
        </p>
      )}

      {sp.ended && (
        <p role="status" className="rounded-lg bg-good-soft px-4 py-3 text-good">
          {t('home.ended')}
        </p>
      )}

      {live ? (
        <section className="card flex flex-col gap-4 border-blue bg-blue-soft p-6">
          <p className="flex items-center gap-2 font-display text-xl font-bold">
            <span className="size-2.5 rounded-full bg-pen motion-safe:animate-pulse" aria-hidden />
            {t('home.inProgress', { title: t('lesson.title', { date: formatLessonDate(live.started_at, locale, timeZone) }) })}
          </p>
          <Link href={`/lesson/${live.id}`} className="btn btn-primary self-start">
            {t('home.joinLesson')}
          </Link>
        </section>
      ) : (
        <section className="card flex flex-col items-start gap-4 p-6">
          <p className="max-w-prose text-muted">{t('home.noLive')}</p>
          <form action={startLesson}>
            <button type="submit" className="btn btn-primary">
              {t('home.startLesson')}
            </button>
          </form>
          <LivePoller />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t('home.pastLessons')}</h2>
        {past.length === 0 ? (
          <p className="text-muted">{t('home.noLessons')}</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line overflow-hidden">
            {past.map((l) => (
              <li key={l.id} className="flex">
                <Link
                  href={`/lesson/${l.id}/review`}
                  className="flex flex-1 items-baseline justify-between gap-4 px-5 py-3.5 hover:bg-surface-2 focus-visible:-outline-offset-2"
                >
                  <span className="font-medium">{t('lesson.title', { date: formatLessonDate(l.started_at, locale, timeZone) })}</span>
                  <span className="text-sm tabular-nums text-muted">
                    {t('home.minutes', { n: minutesBetween(l.started_at, l.ended_at) ?? '–' })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <UsageMeter usage={usage} t={t} locale={locale} />
    </main>
  );
}
