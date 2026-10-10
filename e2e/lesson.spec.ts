import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type Page } from '@playwright/test';

const TEACHER = { email: process.env.E2E_TEACHER_EMAIL!, password: process.env.E2E_TEACHER_PASSWORD! };
const STUDENT = { email: process.env.E2E_STUDENT_EMAIL!, password: process.env.E2E_STUDENT_PASSWORD! };

test.beforeEach(async () => {
  // A failed earlier run can leave a live lesson; end it so "Start lesson" shows.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await admin
    .from('lessons')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('status', 'live');
  if (error) throw error;
});

async function signedInPage(browser: Browser, who: typeof TEACHER): Promise<Page> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in with password' }).click();
  await page.waitForURL('http://localhost:3000/');
  return page;
}

test('teacher and student meet on camera, then the teacher ends the lesson', async ({ browser }) => {
  const teacher = await signedInPage(browser, TEACHER);
  const student = await signedInPage(browser, STUDENT);

  await teacher.getByRole('button', { name: 'Start lesson' }).click();
  await teacher.waitForURL(/\/lesson\/[0-9a-f-]+$/);
  await teacher.getByRole('button', { name: 'Join lesson' }).click();

  await student.reload();
  await student.getByRole('link', { name: 'Join lesson' }).click();
  await expect(student.getByText('Teacher is in the room')).toBeVisible({ timeout: 15_000 });
  await student.getByRole('button', { name: 'Join lesson' }).click();

  await expect(teacher.getByTestId('camera-tile')).toHaveCount(2, { timeout: 30_000 });
  await expect(student.getByTestId('camera-tile')).toHaveCount(2, { timeout: 30_000 });
  await expect(student.locator('[data-stage]')).toHaveAttribute('data-stage', 'cameras');

  await teacher.getByRole('button', { name: 'End lesson' }).click();
  await teacher.getByRole('button', { name: 'Click again to end' }).click();

  await student.waitForURL(/\/\?ended=1$/, { timeout: 30_000 });
  await expect(student.getByText('The lesson has ended.')).toBeVisible();
});

test('the login page switches to French and remembers it', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible();
});

test('a student cannot join a lesson that has ended', async ({ browser }) => {
  const teacher = await signedInPage(browser, TEACHER);
  await teacher.getByRole('button', { name: 'Start lesson' }).click();
  await teacher.waitForURL(/\/lesson\/[0-9a-f-]+$/);
  const lessonUrl = teacher.url();

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  await admin.from('lessons').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('status', 'live');

  const student = await signedInPage(browser, STUDENT);
  await student.goto(lessonUrl);
  await expect(student.getByText('This lesson has ended.')).toBeVisible();
});
