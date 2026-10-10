'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { THEME_COOKIE, themeAttribute, type ThemePref } from '@/lib/theme';

const icon = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SunIcon = () => (
  <svg {...icon}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);

const MoonIcon = () => (
  <svg {...icon}>
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
  </svg>
);

const AutoIcon = () => (
  <svg {...icon}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M5.5 14.5h5" />
  </svg>
);

const OPTIONS: { value: ThemePref; label: MessageKey; Icon: () => React.JSX.Element }[] = [
  { value: 'light', label: 'theme.light', Icon: SunIcon },
  { value: 'dark', label: 'theme.dark', Icon: MoonIcon },
  { value: 'system', label: 'theme.system', Icon: AutoIcon },
];

function saveTheme(next: ThemePref) {
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  const attr = themeAttribute(next);
  if (attr) document.documentElement.dataset.theme = attr;
  else delete document.documentElement.dataset.theme;
}

export function ThemeSwitch({ initial }: { initial: ThemePref }) {
  const t = useT();
  const [pref, setPref] = useState<ThemePref>(initial);

  function choose(next: ThemePref) {
    saveTheme(next);
    setPref(next);
  }

  return (
    <div role="group" aria-label={t('theme.label')} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={t(label)}
          aria-label={t(label)}
          aria-pressed={pref === value}
          onClick={() => choose(value)}
          className={`flex size-8 items-center justify-center rounded-md transition-colors ${pref === value ? 'bg-ink text-paper' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
