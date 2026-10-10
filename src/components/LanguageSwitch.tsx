'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/messages';

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

function saveLocale(next: Locale) {
  document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
}

export function LanguageSwitch() {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();

  function choose(next: Locale) {
    saveLocale(next);
    router.refresh();
  }

  return (
    <div role="group" aria-label={t('lang.label')} className="flex gap-1 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-pressed={locale === o.value}
          onClick={() => choose(o.value)}
          className={`rounded px-2 py-1 ${locale === o.value ? 'bg-ink text-paper' : 'bg-surface-2 text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
