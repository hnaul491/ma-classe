'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};

/** True while the browser tab is in the background. */
export function useTabHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.hidden,
    () => false,
  );
}
