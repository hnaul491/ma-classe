'use client';

import dynamic from 'next/dynamic';

/** Excalidraw needs the browser: `ssr: false` is only allowed in a client component, hence this file. */
export const ReviewBoardLoader = dynamic(() => import('./ReviewBoard'), { ssr: false });
