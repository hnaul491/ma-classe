import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isRole, normalizeEmail } from '@/lib/auth/members';
import type { Member } from '@/lib/lessons/types';

export const getMember = cache(
  async (): Promise<{ user: { email: string } | null; member: Member | null }> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { user: null, member: null };

    const { data } = await supabase
      .from('members')
      .select('email, role, display_name')
      .eq('email', normalizeEmail(user.email))
      .maybeSingle();

    const member =
      data && isRole(data.role)
        ? { email: data.email, role: data.role, display_name: data.display_name }
        : null;
    return { user: { email: user.email }, member };
  },
);
