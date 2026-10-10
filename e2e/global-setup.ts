export default function globalSetup() {
  if (process.env.E2E_ALLOW !== '1' || process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN !== '1') {
    throw new Error(
      'E2E tests only run against the dev Supabase project: set E2E_ALLOW=1 and NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=1 in .env.local',
    );
  }
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'E2E_TEACHER_EMAIL',
    'E2E_TEACHER_PASSWORD',
    'E2E_STUDENT_EMAIL',
    'E2E_STUDENT_PASSWORD',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables for e2e: ${missing.join(', ')}`);
  }
}
