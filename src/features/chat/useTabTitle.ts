'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { titleWithCount } from './notify';

const subscribe = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};

/** "(n) Ma Classe" in the tab while it is hidden and messages wait; the title comes back otherwise. */
export function useTabTitle(unread: number) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => document.hidden,
    () => false,
  );
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
