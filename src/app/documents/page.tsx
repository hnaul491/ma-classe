import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { DocumentsBrowser } from '@/features/documents/DocumentsBrowser';
import { groupDocuments } from '@/features/documents/group';
import { loadFileRows } from '@/features/documents/load';
import { getMember } from '@/lib/auth/session';
import { formatLessonDate } from '@/lib/i18n/messages';
import { getLocale, getT, getThemePref, getTimeZone } from '@/lib/i18n/server';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Documents · Ma Classe' };

export default async function DocumentsPage() {
  const locale = await getLocale();
  const t = await getT();
  const timeZone = await getTimeZone();
  const theme = await getThemePref();
  // getMember throws when Supabase cannot answer; that reaches error.tsx, not the login page.
  const { member } = await getMember();
  if (!member) redirect('/login?denied=1');

  const supabase = await createClient();
  // An outage goes to the error page, not to an empty library (loadFileRows throws too).
  const [files, lessons] = await Promise.all([loadFileRows(supabase), supabase.from('lessons').select('id, started_at, status')]);
  if (lessons.error) throw new Error('Could not load the lessons', { cause: lessons.error });

  const docs = groupDocuments(files);
  const thumbs: Record<string, string> = {};
  const firstPages = docs.map((d) => d.pages[0].storage_path);
  if (firstPages.length > 0) {
    const signed = await supabase.storage.from('lesson-files').createSignedUrls(firstPages, 3600);
    if (signed.error) throw new Error('Could not sign the thumbnails', { cause: signed.error });
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) thumbs[s.path] = s.signedUrl;
  }

  const lessonRows = (lessons.data ?? []) as { id: string; started_at: string; status: string }[];
  const lessonDates: Record<string, string> = {};
  for (const l of lessonRows) lessonDates[l.id] = formatLessonDate(l.started_at, locale, timeZone);
  const live = lessonRows.find((l) => l.status === 'live');

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

      <h1 className="font-display text-3xl font-bold">{t('documents.title')}</h1>

      <DocumentsBrowser docs={docs} thumbs={thumbs} lessonDates={lessonDates} liveLessonId={live?.id} />
    </main>
  );
}
