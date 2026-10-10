'use client';

import { useCallback, useEffect, useState } from 'react';

export function useToast(durationMs = 3000) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), durationMs);
    return () => clearTimeout(id);
  }, [message, durationMs]);
  const show = useCallback((m: string) => setMessage(m), []);
  return { message, show };
}
