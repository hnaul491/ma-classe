'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

export function DevLogin() {
  const router = useRouter();
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
    <form onSubmit={onSubmit} className="flex w-72 flex-col gap-2 rounded-lg border border-dashed border-line p-4">
      <p className="text-xs text-muted">Dev only: password sign-in</p>
      <label className="flex flex-col text-sm">
        Email
        <input id="dev-email" name="email" type="email" className="rounded border border-line bg-surface px-2 py-1" />
      </label>
      <label className="flex flex-col text-sm">
        Password
        <input id="dev-password" name="password" type="password" className="rounded border border-line bg-surface px-2 py-1" />
      </label>
      <button type="submit" className="rounded bg-surface-2 px-3 py-1.5 text-sm">
        Sign in with password
      </button>
      {error && <p className="text-sm text-pen">{error}</p>}
    </form>
  );
}
