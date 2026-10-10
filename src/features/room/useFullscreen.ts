'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTypingElement } from './keys';

/** `keyEnabled`: whether F toggles fullscreen (not on the board, where F is Excalidraw's frame tool). */
export function useFullscreen<T extends HTMLElement>(keyEnabled = true) {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(false);
  const keyEnabledRef = useRef(keyEnabled);
  useEffect(() => {
    keyEnabledRef.current = keyEnabled;
  });

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ref.current?.requestFullscreen();
    } catch {
      // The browser refused fullscreen; the normal layout keeps working.
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (!keyEnabledRef.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingElement(e.target as HTMLElement | null)) return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { ref, active, toggle };
}
