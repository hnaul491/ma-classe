import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serverEnv().serviceRoleKey, {
    auth: { persistSession: false },
  });
}
