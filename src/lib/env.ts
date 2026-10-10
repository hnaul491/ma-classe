function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// One reader per secret, so a missing variable only breaks the feature that needs it.
export function livekitEnv() {
  return {
    url: required('LIVEKIT_URL'),
    key: required('LIVEKIT_API_KEY'),
    secret: required('LIVEKIT_API_SECRET'),
  };
}

export function serviceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY');
}

export function cronSecret(): string {
  return required('CRON_SECRET');
}

export type GoogleConfig = { clientId: string; apiKey: string; appId: string };

/**
 * The Google Drive / Picker settings, or null when any is missing (then the Drive buttons are hidden).
 * Static `process.env.NEXT_PUBLIC_…` references, so Next inlines them into the browser bundle.
 */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY?.trim();
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID?.trim();
  return clientId && apiKey && appId ? { clientId, apiKey, appId } : null;
}

export const PLAN_B_URL = process.env.NEXT_PUBLIC_PLAN_B_URL ?? 'https://meet.google.com';
