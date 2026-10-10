import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { ChatBody } from '@/features/chat/ChatBody';
import { formatChatTime } from '@/features/chat/model';
import { isUuid } from '@/features/documents/params';
import { ReviewBoardLoader } from '@/features/review/ReviewBoardLoader';
import { reviewTarget } from '@/features/review/target';
import { fromRow, VOCAB_COLUMNS, type VocabRow } from '@/features/vocab/model';
import { getMember } from '@/lib/auth/session';
import { formatLessonDate } from '@/lib/i18n/messages';
import { getLocale, getT, getThemePref, getTimeZone } from '@/lib/i18n/server';
import { minutesBetween } from '@/lib/lessons/duration';
import { createClient } from '@/lib/supabase/server';

type LessonRow = { id: string; status: 'live' | 'ended'; started_at: string; ended_at: string | null };
type ChatRow = { id: string; author_email: string; author_name: string; body: string; created_at: string };

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Review · Ma Classe' };
}

/** A past lesson, read-only: its saved board, its chat and its words. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const t = await getT();
  const timeZone = await getTimeZone();
  const theme = await getThemePref();
  // getMember throws when Supabase cannot answer; that reaches error.tsx, not the login page.
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  // A malformed id would fail the uuid query (22P02) and reach the error page instead of a 404.
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.from('lessons').select('id, status, started_at, ended_at').eq('id', id).maybeSingle();
  // An outage goes to the error page, not to "not found".
  if (error) throw new Error('Could not load the lesson', { cause: error });
  const lesson = data as LessonRow | null;
  const target = reviewTarget(id, lesson);
  if (target === 'not-found' || !lesson) notFound();
  if (target === 'live') redirect(`/lesson/${id}`);

  const [chat, vocab] = await Promise.all([
    supabase.from('chat').select('id, author_email, author_name, body, created_at').eq('lesson_id', id).order('created_at'),
    supabase.from('vocab').select(VOCAB_COLUMNS).eq('lesson_id', id).order('created_at'),
  ]);
  if (chat.error) throw new Error('Could not load the chat', { cause: chat.error });
  // Undefined table / not in PostgREST's schema cache: migration 0007 has not been run, so no words yet.
  const vocabNotReady = vocab.error?.code === '42P01' || vocab.error?.code === 'PGRST205';
  if (vocab.error && !vocabNotReady) throw new Error('Could not load the vocabulary', { cause: vocab.error });

  const messages = (chat.data ?? []) as ChatRow[];
  const words = vocabNotReady ? [] : ((vocab.data ?? []) as VocabRow[]).map(fromRow);
  const time = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="rounded-md">
          <Wordmark />
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <ThemeSwitch initial={theme} />
          <LanguageSwitch />
        </div>
      </header>

      <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-3xl font-bold">
        {t('lesson.title', { date: formatLessonDate(lesson.started_at, locale, timeZone) })}
        <span className="font-sans text-base font-medium tabular-nums text-muted">
          {t('home.minutes', { n: minutesBetween(lesson.started_at, lesson.ended_at) ?? '–' })}
        </span>
      </h1>

      <section aria-labelledby="review-board" className="flex flex-col gap-3">
        <h2 id="review-board" className="text-xl font-bold">
          {t('review.board')}
        </h2>
        <ReviewBoardLoader lessonId={id} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="review-chat" className="card flex min-w-0 flex-col gap-4 p-5">
          <h2 id="review-chat" className="text-xl font-bold">
            {t('chat.title')}
          </h2>
          {messages.length === 0 ? (
            <p className="text-sm text-muted">{t('review.noChat')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {messages.map((m) => (
                <li key={m.id} className="min-w-0">
                  <div className="flex items-baseline gap-2 text-xs text-muted">
                    <span className="font-semibold text-ink">{m.author_name}</span>
                    <time dateTime={m.created_at}>{formatChatTime(m.created_at, time)}</time>
                  </div>
                  <ChatBody text={m.body} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="review-vocab" className="card flex min-w-0 flex-col gap-4 p-5">
          <h2 id="review-vocab" className="text-xl font-bold">
            {t('vocab.title')}
          </h2>
          {words.length === 0 ? (
            <p className="text-sm text-muted">{t('review.noVocab')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {words.map((w) => (
                <li key={w.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                  <p lang="fr" className="break-words font-semibold">
                    {w.french}
                  </p>
                  {w.meaningVi && (
                    <p lang="vi" className="break-words">
                      {w.meaningVi}
                    </p>
                  )}
                  {w.meaningEn && (
                    <p lang="en" className="break-words">
                      {w.meaningEn}
                    </p>
                  )}
                  {w.example && (
                    <p lang="fr" className="whitespace-pre-wrap break-words italic text-muted">
                      {w.example}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
