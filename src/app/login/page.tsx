import { LanguageSwitch } from '@/components/LanguageSwitch';
import { getT } from '@/lib/i18n/server';
import { DevLogin } from './DevLogin';
import { GoogleButton } from './GoogleButton';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
      <LanguageSwitch />
      <h1 className="text-3xl font-bold">Ma Classe</h1>
      {sp.denied && <p className="text-pen">{t('login.private')}</p>}
      {sp.error && <p className="text-pen">{t('login.failed')}</p>}
      <GoogleButton signOutFirst={Boolean(sp.denied)} />
      {process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN === '1' && <DevLogin />}
    </main>
  );
}
