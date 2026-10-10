import { cookies, headers } from 'next/headers';
import { pickTheme, THEME_COOKIE, type ThemePref } from '@/lib/theme';
import { isValidTimeZone, pickLocale, translate, type Locale, type MessageKey } from './messages';

export async function getLocale(): Promise<Locale> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return pickLocale(c.get('lang')?.value, h.get('accept-language'));
}

export async function getTimeZone(): Promise<string> {
  const raw = (await cookies()).get('tz')?.value;
  let tz: string | undefined;
  try {
    tz = raw === undefined ? undefined : decodeURIComponent(raw);
  } catch {
    tz = undefined;
  }
  return isValidTimeZone(tz) ? tz : 'Europe/Paris';
}

export async function getThemePref(): Promise<ThemePref> {
  return pickTheme((await cookies()).get(THEME_COOKIE)?.value);
}

export async function getT() {
  const locale = await getLocale();
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
