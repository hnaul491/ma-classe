'use client';

import { useEffect, useState } from 'react';

export function usePresence(lessonId: string) {
  const [presence, setPresence] = useState({ teacher: false, student: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/presence?lesson=${encodeURIComponent(lessonId)}`);
        if (res.ok && alive) setPresence(await res.json());
      } catch {
        // Network hiccup: keep the last known value and try again on the next tick.
      }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lessonId]);
  return presence;
}
