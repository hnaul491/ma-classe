import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { getT, getThemePref } from '@/lib/i18n/server';
import { DevLogin } from './DevLogin';
import { GoogleButton } from './GoogleButton';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = await getT();
  const theme = await getThemePref();
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <ThemeSwitch initial={theme} />
        <LanguageSwitch />
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-5">
          <h1>
            <Wordmark size="lg" />
          </h1>
          <p className="text-muted">{t('login.tagline')}</p>
        </div>

        {(sp.denied || sp.error) && (
          <p role="alert" className="w-full rounded-lg bg-pen-soft px-4 py-3 text-sm text-pen">
            {sp.denied ? t('login.private') : t('login.failed')}
          </p>
        )}

        <GoogleButton signOutFirst={Boolean(sp.denied)} />
        {process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN === '1' && <DevLogin />}
      </div>
    </main>
  );
}
