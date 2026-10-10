import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { fromRow, VOCAB_COLUMNS, type VocabRow } from '@/features/vocab/model';
import { VocabBook } from '@/features/vocab/VocabBook';
import { getMember } from '@/lib/auth/session';
import { formatLessonDate } from '@/lib/i18n/messages';
import { getLocale, getT, getThemePref, getTimeZone } from '@/lib/i18n/server';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Vocabulary · Ma Classe' };

export default async function VocabPage() {
  const locale = await getLocale();
  const t = await getT();
  const timeZone = await getTimeZone();
  const theme = await getThemePref();
  // getMember throws when Supabase cannot answer; that reaches error.tsx, not the login page.
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  const [vocab, lessons] = await Promise.all([
    supabase.from('vocab').select(VOCAB_COLUMNS).order('created_at', { ascending: false }),
    supabase.from('lessons').select('id, started_at'),
  ]);
  // Undefined table / not in PostgREST's schema cache: migration 0007 has not been run.
  const notReady = vocab.error?.code === '42P01' || vocab.error?.code === 'PGRST205';
  // An outage goes to the error page, not to an empty book.
  if (vocab.error && !notReady) throw new Error('Could not load the vocabulary', { cause: vocab.error });
  if (lessons.error) throw new Error('Could not load the lessons', { cause: lessons.error });

  const words = ((vocab.data ?? []) as VocabRow[]).map(fromRow);
  const lessonDates: Record<string, string> = {};
  for (const l of (lessons.data ?? []) as { id: string; started_at: string }[]) {
    lessonDates[l.id] = formatLessonDate(l.started_at, locale, timeZone);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="rounded-md">
          <Wordmark />
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <ThemeSwitch initial={theme} />
          <LanguageSwitch />
        </div>
      </header>

      <h1 className="font-display text-3xl font-bold">{t('vocab.title')}</h1>

      {notReady ? (
        <p role="status" className="card max-w-prose p-6 text-muted">
          {t('vocab.notReady')}
        </p>
      ) : (
        <VocabBook initial={words} lessonDates={lessonDates} member={member} />
      )}
    </main>
  );
}
