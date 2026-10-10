import { cookies, headers } from 'next/headers';
import { pickLocale, translate, type Locale, type MessageKey } from './messages';

export async function getLocale(): Promise<Locale> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return pickLocale(c.get('lang')?.value, h.get('accept-language'));
}

export async function getT() {
  const locale = await getLocale();
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
