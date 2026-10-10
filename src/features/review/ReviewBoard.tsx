'use client';

import '@excalidraw/excalidraw/index.css';
import { Excalidraw, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import { useEffect, useMemo, useState } from 'react';
import { sceneFileIds } from '@/features/board/files';
import { loadBoard, loadFiles } from '@/features/board/persistence';
import type { BoardElement } from '@/features/board/protocol';
import { downloadAsDataURL } from '@/features/board/upload';
import { useThemeName } from '@/features/board/useThemeName';
import { useLocale, useT } from '@/lib/i18n/client';
import { hasLiveElements } from './target';

/** Module-level so Excalidraw's memo sees the same object every render. */
const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: false,
    clearCanvas: false,
    changeViewBackgroundColor: false,
    toggleTheme: false,
  },
} satisfies ExcalidrawProps['UIOptions'];

type Loaded = { state: 'loading' } | { state: 'empty' } | { state: 'failed' } | { state: 'ready'; elements: BoardElement[] };

const NOTES = { loading: 'review.boardLoading', empty: 'review.boardEmpty', failed: 'review.boardFailed' } as const;

/** A past lesson's saved board, read-only: view mode, no saving, no live channel. */
export default function ReviewBoard({ lessonId }: { lessonId: string }) {
  const t = useT();
  const locale = useLocale();
  const theme = useThemeName();
  const [board, setBoard] = useState<Loaded>({ state: 'loading' });
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBoard(lessonId).then(
      (elements) => {
        if (!cancelled) setBoard(hasLiveElements(elements) ? { state: 'ready', elements } : { state: 'empty' });
      },
      () => {
        if (!cancelled) setBoard({ state: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const elements = board.state === 'ready' ? board.elements : null;

  // The images come after the scene, one by one: a failed one stays a placeholder, the board still shows.
  useEffect(() => {
    if (!api || !elements) return;
    let cancelled = false;
    void (async () => {
      let files;
      try {
        files = await loadFiles(sceneFileIds(elements));
      } catch {
        return;
      }
      await Promise.allSettled(
        files.map(async (f) => {
          const { dataURL, mime } = await downloadAsDataURL(f.storage_path, f.mime);
          if (cancelled) return;
          api.addFiles([{ id: f.id as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: mime, created: Date.now() }]);
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [api, elements]);

  // Restored once per scene: a new initialData object on every render would mean nothing to Excalidraw anyway.
  const initialData = useMemo(
    () => (elements ? { elements: restoreElements(elements as unknown as readonly ExcalidrawElement[], null), scrollToContent: true } : null),
    [elements],
  );

  if (board.state !== 'ready' || !initialData) {
    return (
      <p role={board.state === 'failed' ? 'alert' : 'status'} className="card p-6 text-muted">
        {t(NOTES[board.state === 'ready' ? 'loading' : board.state])}
      </p>
    );
  }

  return (
    <div className="h-[70vh] min-h-80 overflow-hidden rounded-xl border border-line">
      <Excalidraw
        initialData={initialData}
        viewModeEnabled
        zenModeEnabled
        theme={theme}
        langCode={locale === 'fr' ? 'fr-FR' : 'en'}
        excalidrawAPI={setApi}
        UIOptions={UI_OPTIONS}
      />
    </div>
  );
}
