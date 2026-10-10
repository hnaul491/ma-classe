'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Live match of a CSS media query; false on the server. */
export function useMediaQuery(query: string): boolean {
  // Stable per query, so React does not resubscribe on every render.
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
