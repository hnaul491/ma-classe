'use client';

import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatLessonDate, type Locale } from '@/lib/i18n/messages';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { DocumentsBrowser } from './DocumentsBrowser';
import { groupDocuments, type DocumentGroup } from './group';
import { loadFileRows } from './load';
import { Modal } from './Modal';

type Library = { docs: DocumentGroup[]; thumbs: Record<string, string>; lessonDates: Record<string, string> };

async function loadLibrary(locale: Locale): Promise<Library> {
  const supabase = createBrowserSupabase();
  const [files, lessons] = await Promise.all([loadFileRows(supabase), supabase.from('lessons').select('id, started_at')]);
  if (lessons.error) throw new Error('Could not load the lessons', { cause: lessons.error });
  const docs = groupDocuments(files);
  const thumbs: Record<string, string> = {};
  const firstPages = docs.map((d) => d.pages[0].storage_path);
  if (firstPages.length > 0) {
    const signed = await supabase.storage.from('lesson-files').createSignedUrls(firstPages, 3600);
    if (signed.error) throw new Error('Could not sign the thumbnails', { cause: signed.error });
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) thumbs[s.path] = s.signedUrl;
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lessonDates: Record<string, string> = {};
  for (const l of (lessons.data ?? []) as { id: string; started_at: string }[]) {
    lessonDates[l.id] = formatLessonDate(l.started_at, locale, timeZone);
  }
  return { docs, thumbs, lessonDates };
}

/** "From my documents" on the board: pick an earlier document to place again, without uploading it. */
export function DocumentPicker({
  onPick,
  onClose,
  returnFocus,
}: {
  onPick: (d: DocumentGroup) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [library, setLibrary] = useState<Library | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLibrary(locale).then(
      (lib) => !cancelled && setLibrary(lib),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <Modal title={t('board.addFromDocuments')} onClose={onClose} returnFocus={returnFocus}>
      <div className="mx-auto w-full max-w-6xl px-4 py-5">
        {failed ? (
          <p role="alert" className="rounded-lg bg-pen-soft px-4 py-3 text-pen">
            {t('documents.loadFailed')}
          </p>
        ) : library ? (
          <DocumentsBrowser docs={library.docs} thumbs={library.thumbs} lessonDates={library.lessonDates} onPick={onPick} />
        ) : (
          <p role="status" className="text-muted">
            {t('documents.loading')}
          </p>
        )}
      </div>
    </Modal>
  );
}
