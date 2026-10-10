'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function readCookie(name: string): string | undefined {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  if (!hit) return undefined;
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== readCookie('tz')) {
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [router]);
  return null;
}
