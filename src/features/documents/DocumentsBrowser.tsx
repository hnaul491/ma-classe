'use client';

/* eslint-disable @next/next/no-img-element -- signed Supabase URLs expire; next/image would cache them under its own URL. */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { filterDocuments, type DocumentGroup } from './group';
import { Modal } from './Modal';
import { currentPageFrom } from './viewer';

const BUCKET = 'lesson-files';
const SIGNED_URL_SECONDS = 3600;

type T = ReturnType<typeof useT>;

function pagesLabel(t: T, n: number) {
  return n === 1 ? t('documents.onePage') : t('documents.pages', { n });
}

/**
 * Fresh signed URLs for images whose URL failed (expired). Each path is re-signed once, so a
 * missing file does not loop. Returns the renewed URLs by path and the `onError` handler.
 */
function useResignedUrls() {
  const [fresh, setFresh] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());
  const resign = useCallback((path: string) => {
    if (tried.current.has(path)) return;
    tried.current.add(path);
    void createBrowserSupabase()
      .storage.from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
      .then(({ data }) => {
        if (data?.signedUrl) setFresh((prev) => ({ ...prev, [path]: data.signedUrl }));
      }, () => {});
  }, []);
  return [fresh, resign] as const;
}

/**
 * Every uploaded document as a searchable grid. With `onPick`, a card picks the document
 * (the board's "From my documents"); without it, a card opens the document in a viewer.
 */
export function DocumentsBrowser({
  docs,
  thumbs,
  lessonDates,
  liveLessonId,
  onPick,
}: {
  docs: DocumentGroup[];
  /** Signed URL by storage path, for each document's first page. */
  thumbs: Record<string, string>;
  /** Formatted lesson date by lesson id. */
  lessonDates: Record<string, string>;
  liveLessonId?: string;
  onPick?: (d: DocumentGroup) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState<DocumentGroup | null>(null);
  const [freshThumbs, resignThumb] = useResignedUrls();
  const shown = filterDocuments(docs, query);

  if (docs.length === 0) {
    return <p className="card max-w-prose p-6 text-muted">{t('documents.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <input
        type="search"
        className="field sm:max-w-sm"
        aria-label={t('documents.search')}
        placeholder={t('documents.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length === 0 ? (
        <p role="status" className="text-muted">
          {t('documents.noMatch')}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((d) => {
            const thumbPath = d.pages[0].storage_path;
            const thumb = freshThumbs[thumbPath] ?? thumbs[thumbPath];
            const date = lessonDates[d.lessonId];
            return (
              <li key={d.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => (onPick ? onPick(d) : setViewing(d))}
                  className="card flex w-full flex-col overflow-hidden text-left transition-colors hover:border-blue"
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={d.name}
                      loading="lazy"
                      onError={() => resignThumb(thumbPath)}
                      className="aspect-[3/4] w-full bg-surface-2 object-cover object-top"
                    />
                  ) : (
                    <span aria-hidden className="flex aspect-[3/4] w-full items-center justify-center bg-surface-2 font-display text-lg font-bold text-muted">
                      {d.kind === 'pdf' ? 'PDF' : 'IMG'}
                    </span>
                  )}
                  <span className="flex flex-col gap-0.5 border-t border-line px-3 py-2.5">
                    <span className="truncate font-medium" title={d.name}>
                      {d.name}
                    </span>
                    <span className="truncate text-sm text-muted">
                      {pagesLabel(t, d.pages.length)}
                      {date && ` · ${t('lesson.title', { date })}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {viewing && (
        <DocumentViewer
          doc={viewing}
          firstThumb={freshThumbs[viewing.pages[0].storage_path] ?? thumbs[viewing.pages[0].storage_path]}
          liveLessonId={liveLessonId}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function DocumentViewer({
  doc,
  firstThumb,
  liveLessonId,
  onClose,
}: {
  doc: DocumentGroup;
  firstThumb?: string;
  liveLessonId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string>>(() => (firstThumb ? { [doc.pages[0].storage_path]: firstThumb } : {}));
  const [failed, setFailed] = useState(false);
  const [fresh, resign] = useResignedUrls();
  const [current, setCurrent] = useState(0);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);

  // Signed URLs for every page, created when the viewer opens.
  useEffect(() => {
    let cancelled = false;
    void createBrowserSupabase()
      .storage.from(BUCKET)
      .createSignedUrls(doc.pages.map((p) => p.storage_path), SIGNED_URL_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) return setFailed(true);
        const next: Record<string, string> = {};
        for (const s of data) if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
        setUrls((prev) => ({ ...prev, ...next }));
      }, () => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Track the page in view, so ← / → and the page buttons follow manual scrolling.
  useEffect(() => {
    const els = pageRefs.current.filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        const page = currentPageFrom(
          entries.map((e) => ({ index: Number((e.target as HTMLElement).dataset.index), isIntersecting: e.isIntersecting, intersectionRatio: e.intersectionRatio })),
        );
        if (page !== null) setCurrent(page);
      },
      // A thin reading band near the top: works for pages taller than the screen too.
      { rootMargin: '-40% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [doc]);

  function goTo(i: number) {
    const n = Math.max(0, Math.min(doc.pages.length - 1, i));
    setCurrent(n);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pageRefs.current[n]?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }

  return (
    <Modal
      title={doc.name}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          goTo(current + 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          goTo(current - 1);
        }
      }}
      actions={
        liveLessonId && (
          <Link href={`/lesson/${liveLessonId}?add=${doc.id}`} className="btn btn-primary btn-sm">
            {t('documents.addToLesson')}
          </Link>
        )
      }
    >
      <div className="flex flex-col items-center gap-6 px-3 py-6 sm:px-6">
        {failed && (
          <p role="alert" className="rounded-lg bg-pen-soft px-4 py-3 text-pen">
            {t('documents.loadFailed')}
          </p>
        )}
        {doc.pages.length > 1 && (
          <nav aria-label={t('board.pages')} className="card sticky top-0 z-10 flex max-w-full flex-wrap justify-center gap-1 p-1 shadow-sm">
            {doc.pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                aria-label={t('board.page', { n: i + 1 })}
                aria-current={i === current ? 'page' : undefined}
                onClick={() => goTo(i)}
                className={`min-w-8 rounded-md px-2 py-1 text-sm font-medium tabular-nums ${i === current ? 'bg-blue text-surface' : 'hover:bg-surface-2'}`}
              >
                {i + 1}
              </button>
            ))}
          </nav>
        )}
        {doc.pages.map((p, i) => {
          const url = fresh[p.storage_path] ?? urls[p.storage_path];
          const alt = doc.pages.length > 1 ? `${doc.name} – ${t('board.page', { n: i + 1 })}` : doc.name;
          return (
            <figure
              key={p.id}
              ref={(el) => {
                pageRefs.current[i] = el;
              }}
              data-index={i}
              className="w-full max-w-3xl scroll-mt-16"
            >
              {url ? (
                <img
                  src={url}
                  alt={alt}
                  loading="lazy"
                  onError={() => resign(p.storage_path)}
                  width={p.width}
                  height={p.height}
                  className="h-auto w-full rounded-lg border border-line bg-surface shadow-sm"
                />
              ) : (
                <div
                  role="img"
                  aria-label={alt}
                  style={{ aspectRatio: `${p.width} / ${p.height}` }}
                  className="w-full animate-pulse rounded-lg border border-line bg-surface-2 motion-reduce:animate-none"
                />
              )}
            </figure>
          );
        })}
      </div>
    </Modal>
  );
}
