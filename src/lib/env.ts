function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function serverEnv() {
  return {
    livekitUrl: required('LIVEKIT_URL'),
    livekitKey: required('LIVEKIT_API_KEY'),
    livekitSecret: required('LIVEKIT_API_SECRET'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    cronSecret: required('CRON_SECRET'),
  };
}

export const PLAN_B_URL = process.env.NEXT_PUBLIC_PLAN_B_URL ?? 'https://meet.google.com';
