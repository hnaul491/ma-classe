import { createClient } from '@supabase/supabase-js';
import { serviceRoleKey } from '@/lib/env';

export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey(), {
    auth: { persistSession: false },
  });
}
