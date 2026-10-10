'use client';

import { pdfPagesError, type RenderedPage } from './upload';

/** About 150 DPI: pdf.js units are 72 per inch. */
const PDF_SCALE = 150 / 72;
const WEBP_QUALITY = 0.82;
const MAX_IMAGE_SIDE = 2000;

export class PageLimitError extends Error {
  constructor(public pages: number) {
    super(`PDF has ${pages} pages`);
    this.name = 'PageLimitError';
  }
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the page'))), 'image/webp', WEBP_QUALITY),
  );
}

/** Renders every page to WebP; `onPage(n, total)` is called as page n starts rendering. */
export async function renderPdf(file: File, onPage?: (n: number, total: number) => void): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    if (pdfPagesError(doc.numPages)) throw new PageLimitError(doc.numPages);
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      onPage?.(n, doc.numPages);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: PDF_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await canvasToWebp(canvas);
      pages.push({ blob, width: canvas.width, height: canvas.height });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return pages;
  } finally {
    void task.destroy();
  }
}

export async function imageToWebp(file: File): Promise<RenderedPage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { blob: await canvasToWebp(canvas), width: canvas.width, height: canvas.height };
}
