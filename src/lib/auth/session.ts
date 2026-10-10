import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isRole, normalizeEmail } from '@/lib/auth/members';
import type { Member } from '@/lib/lessons/types';

/** No session, or the auth server answered and rejected it (expired, revoked). Anything else is an outage. */
function isSignedOut(error: unknown): boolean {
  return isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status >= 400 && error.status < 500);
}

/**
 * Throws when Supabase cannot answer, so an outage shows the error page
 * instead of telling a real member "This classroom is private."
 */
export const getMember = cache(
  async (): Promise<{ user: { email: string } | null; member: Member | null }> => {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError && !isSignedOut(authError)) {
      throw new Error('Could not check membership', { cause: authError });
    }
    if (!user?.email) return { user: null, member: null };

    const { data, error } = await supabase
      .from('members')
      .select('email, role, display_name')
      .eq('email', normalizeEmail(user.email))
      .maybeSingle();
    if (error) throw new Error('Could not check membership', { cause: error });

    const member =
      data && isRole(data.role)
        ? { email: data.email, role: data.role, display_name: data.display_name }
        : null;
    return { user: { email: user.email }, member };
  },
);
