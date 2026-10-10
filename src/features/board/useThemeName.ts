'use client';

import { useEffect, useState } from 'react';

function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' || (!attr && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

/** The page's theme for Excalidraw, following the theme switch and the system setting. */
export function useThemeName(): 'light' | 'dark' {
  // Read synchronously on first render (the boards are client-only) so dark mode does not flash.
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const read = () => setTheme(readTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mq.addEventListener('change', read);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', read);
    };
  }, []);
  return theme;
}
