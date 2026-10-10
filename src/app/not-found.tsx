import Link from 'next/link';
import { getT } from '@/lib/i18n/server';

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <Link href="/" className="btn btn-secondary">
        {t('lesson.backHome')}
      </Link>
    </main>
  );
}
