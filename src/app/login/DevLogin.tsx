'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { createBrowserSupabase } from '@/lib/supabase/client';

export function DevLogin() {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { error } = await createBrowserSupabase().auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) return setError(error.message);
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3 rounded-xl border border-dashed border-line p-4 text-left">
      <p className="text-xs text-muted">{t('login.devOnly')}</p>
      <label className="field-label">
        {t('login.email')}
        <input id="dev-email" name="email" type="email" className="field" />
      </label>
      <label className="field-label">
        {t('login.password')}
        <input id="dev-password" name="password" type="password" className="field" />
      </label>
      <button type="submit" className="btn btn-secondary">
        {t('login.withPassword')}
      </button>
      {error && <p className="text-sm text-pen">{error}</p>}
    </form>
  );
}
