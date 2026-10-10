/** True only for a Supabase CLI local stack (`supabase start`), never a hosted project. */
export function isLocalSupabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}
