'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoHide(enabled: boolean, ms = 3000) {
  const [visible, setVisible] = useState(true);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Turning auto-hide on or off shows the controls again. Adjusting state while
  // rendering avoids an extra effect pass (https://react.dev/learn/you-might-not-need-an-effect).
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled);
    setVisible(true);
  }

  const hideLater = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), ms);
  }, [ms]);

  const poke = useCallback(() => {
    setVisible(true);
    hideLater();
  }, [hideLater]);

  useEffect(() => {
    if (!enabled) return;
    hideLater();
    return () => clearTimeout(timer.current);
  }, [enabled, hideLater]);

  return { visible: !enabled || visible, poke };
}
