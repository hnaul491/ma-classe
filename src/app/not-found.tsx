import Link from 'next/link';
import { getT } from '@/lib/i18n/server';

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <p className="text-lg">{t('notFound.title')}</p>
      <Link href="/" className="text-blue underline">
        {t('lesson.backHome')}
      </Link>
    </main>
  );
}
