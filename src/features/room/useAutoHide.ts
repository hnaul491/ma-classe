'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoHide(enabled: boolean, ms = 3000) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poke = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), ms);
  }, [ms]);

  useEffect(() => {
    if (!enabled) {
      clearTimeout(timer.current);
      setVisible(true);
      return;
    }
    poke();
    return () => clearTimeout(timer.current);
  }, [enabled, poke]);

  return { visible: !enabled || visible, poke };
}
