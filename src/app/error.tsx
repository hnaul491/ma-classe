'use client'; // Error boundaries must be Client Components.

import Link from 'next/link';
import { useEffect } from 'react';
import { useT } from '@/lib/i18n/client';

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <p className="text-lg">{t('error.title')}</p>
      <button type="button" onClick={() => retry()} className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface">
        {t('error.retry')}
      </button>
      <Link href="/" className="text-blue underline">
        {t('lesson.backHome')}
      </Link>
    </main>
  );
}
