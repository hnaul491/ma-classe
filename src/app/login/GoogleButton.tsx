'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/client';
import { createBrowserSupabase } from '@/lib/supabase/client';

export function GoogleButton({ signOutFirst }: { signOutFirst: boolean }) {
  const t = useT();
  useEffect(() => {
    // A signed-in non-member is sent here with ?denied=1; drop their session.
    if (signOutFirst) void createBrowserSupabase().auth.signOut();
  }, [signOutFirst]);

  return (
    <button
      type="button"
      className="rounded-lg bg-blue px-5 py-2.5 font-semibold text-surface"
      onClick={() =>
        createBrowserSupabase().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        })
      }
    >
      {t('login.google')}
    </button>
  );
}
