'use client';

import { useEffect } from 'react';
import { titleWithCount } from './notify';
import { useTabHidden } from './useTabHidden';

/** "(n) Ma Classe" in the tab while it is hidden and messages wait; the title comes back otherwise. */
export function useTabTitle(unread: number) {
  const hidden = useTabHidden();
  const active = hidden && unread > 0;
  useEffect(() => {
    if (!active) return;
    const base = document.title;
    document.title = titleWithCount(base, unread);
    return () => {
      document.title = base;
    };
  }, [active, unread]);
}
