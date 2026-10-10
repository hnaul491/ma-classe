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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <h1 className="text-2xl font-bold">{t('error.title')}</h1>
      <button type="button" onClick={() => retry()} className="btn btn-primary">
        {t('error.retry')}
      </button>
      <Link href="/" className="link">
        {t('lesson.backHome')}
      </Link>
    </main>
  );
}
