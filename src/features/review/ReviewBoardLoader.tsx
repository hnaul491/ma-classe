'use client';

import dynamic from 'next/dynamic';
import { useT } from '@/lib/i18n/client';

/** Shown while the board's code downloads, with the same note the board shows while its scene loads. */
function BoardLoading() {
  const t = useT();
  return (
    <p role="status" className="card p-6 text-muted">
      {t('review.boardLoading')}
    </p>
  );
}

/** Excalidraw needs the browser: `ssr: false` is only allowed in a client component, hence this file. */
export const ReviewBoardLoader = dynamic(() => import('./ReviewBoard'), { ssr: false, loading: () => <BoardLoading /> });
