'use client';

import '@excalidraw/excalidraw/index.css';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, reconcileElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, Collaborator, ExcalidrawImperativeAPI, NormalizedZoomValue, SocketId } from '@excalidraw/excalidraw/types';
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { backupKey, loadBoard, saveBoard } from '@/features/board/persistence';
import type { BoardElement, BoardMessage } from '@/features/board/protocol';
import { imageToWebp, PageLimitError, renderPdf } from '@/features/board/render';
import { createSaveQueue } from '@/features/board/saveQueue';
import { checkUpload, downloadAsDataURL, uploadBoardImage, type RenderedPage } from '@/features/board/upload';
import { useBoardChannel } from '@/features/board/useBoardChannel';
import { changedElements, markKnown, type KnownVersions } from '@/features/board/versions';
import { followReducer, layoutPages, scrollForCenter, viewCenter } from '@/features/board/view';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Member } from '@/lib/lessons/types';

const SEND_EVERY_MS = 50;
const VIEWPORT_EVERY_MS = 100;
const POINTER_EVERY_MS = 50;

function useThemeName(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.dataset.theme;
      setTheme(attr === 'dark' || (!attr && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    };
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mq.addEventListener('change', read);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', read);
    };
  }, []);
  return theme;
}

export default function Board({
  lessonId,
  member,
  visible,
  onError,
}: {
  lessonId: string;
  member: Member;
  visible: boolean;
  onError: (key: MessageKey) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const theme = useThemeName();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const known = useRef<KnownVersions>(new Map());
  const pendingSend = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastViewportSent = useRef(0);
  const lastPointerSent = useRef(0);
  const collaborators = useRef(new Map<SocketId, Collaborator>());
  const [follow, dispatchFollow] = useReducer(followReducer, { following: member.role === 'student', lastApplied: null });
  const [progress, setProgress] = useState<string | null>(null);
  const [frames, setFrames] = useState<ExcalidrawElement[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Latest onError without re-running effects when the parent passes a new function.
  const reportError = useEffectEvent((key: MessageKey) => onError(key));

  // Created in an effect (not during render) so a StrictMode remount gets a fresh, undisposed queue.
  const queue = useRef<SaveQueue | null>(null);
  useEffect(() => {
    const q = createSaveQueue({
      save: (scene) => saveBoard(lessonId, member.email, (scene as { elements: BoardElement[] }).elements),
      backup: (scene) => {
        try {
          localStorage.setItem(backupKey(lessonId), JSON.stringify(scene));
        } catch {
          // Storage full or blocked: the retry still runs.
        }
      },
      onFailures: (n) => {
        if (n === 3) reportError('board.saveFailed');
      },
    });
    queue.current = q;
    return () => {
      if (queue.current === q) queue.current = null;
      void q.flush();
      q.dispose();
    };
  }, [lessonId, member.email]);

  const addFileFromStorage = useCallback(
    async (fileId: string, path: string, mime: string) => {
      if (!api || api.getFiles()[fileId]) return;
      const dataURL = await downloadAsDataURL(path);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: mime as BinaryFileData['mimeType'], created: Date.now() }]);
    },
    [api],
  );

  const applyRemote = useCallback(
    (remote: BoardElement[]) => {
      if (!api) return;
      const merged = reconcileElements(
        api.getSceneElementsIncludingDeleted() as OrderedExcalidrawElement[],
        remote as unknown as RemoteExcalidrawElement[],
        api.getAppState(),
      );
      markKnown(known.current, remote);
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [api],
  );

  // The message handler replies through `send`, which the hook returns below; read it from a ref.
  const sendRef = useRef<BoardSend | null>(null);
  const { send } = useBoardChannel((msg: BoardMessage, from: string) => {
    if (!api) return;
    switch (msg.t) {
      case 'elements':
        applyRemote(msg.elements);
        break;
      case 'scene-req':
        void sendRef.current?.(
          { t: 'elements', elements: api.getSceneElementsIncludingDeleted() as unknown as BoardElement[] },
          { to: [from] },
        ).catch(() => {});
        break;
      case 'file':
        void addFileFromStorage(msg.fileId, msg.path, msg.mime).catch(() => {});
        break;
      case 'viewport': {
        if (member.role !== 'student' || !follow.following) break;
        const state = api.getAppState();
        const next = scrollForCenter({ cx: msg.cx, cy: msg.cy }, msg.zoom, { width: state.width, height: state.height });
        dispatchFollow({ type: 'applied', ...next, zoom: msg.zoom });
        api.updateScene({
          appState: { scrollX: next.scrollX, scrollY: next.scrollY, zoom: { value: msg.zoom as NormalizedZoomValue } },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        break;
      }
      case 'pointer': {
        collaborators.current.set(from as SocketId, {
          pointer: { x: msg.x, y: msg.y, tool: msg.tool, renderCursor: msg.tool !== 'laser' },
          button: msg.button,
          username: from,
        });
        api.updateScene({ collaborators: new Map(collaborators.current) });
        break;
      }
    }
  });
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // First load: the saved scene and its images, then ask the other person for anything newer.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadBoard(lessonId);
        if (cancelled) return;
        await Promise.all(saved.files.map((f) => addFileFromStorage(f.id, f.storage_path, f.mime).catch(() => {})));
        if (saved.elements.length > 0) applyRemote(saved.elements);
      } catch {
        reportError('board.loadFailed');
      }
      void send({ t: 'scene-req' }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [api, lessonId, addFileFromStorage, applyRemote, send]);

  // A hidden Excalidraw has zero size; re-measure when it becomes visible.
  useEffect(() => {
    if (visible) api?.refresh();
  }, [visible, api]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      const all = elements as unknown as BoardElement[];
      const nextFrames = elements.filter((e) => e.type === 'frame' && !e.isDeleted);
      // onChange fires on every pointer move; only re-render when the frames really changed.
      setFrames((prev) =>
        prev.length === nextFrames.length && prev.every((f, i) => f.id === nextFrames[i].id && f.version === nextFrames[i].version)
          ? prev
          : nextFrames,
      );
      clearTimeout(pendingSend.current);
      pendingSend.current = setTimeout(() => {
        const changed = changedElements(known.current, all);
        if (changed.length === 0) return;
        markKnown(known.current, changed);
        void send({ t: 'elements', elements: changed }).catch(() => {});
        queue.current?.push({ elements: all });
      }, SEND_EVERY_MS);
    },
    [send],
  );

  const onScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      if (!api) return;
      if (member.role === 'student') {
        dispatchFollow({ type: 'scrolled', scrollX, scrollY, zoom: zoom.value });
        return;
      }
      const now = Date.now();
      if (now - lastViewportSent.current < VIEWPORT_EVERY_MS) return;
      lastViewportSent.current = now;
      const { width, height } = api.getAppState();
      const c = viewCenter({ scrollX, scrollY, zoom: zoom.value, width, height });
      void send({ t: 'viewport', cx: c.cx, cy: c.cy, zoom: zoom.value }, { lossy: true }).catch(() => {});
    },
    [api, member.role, send],
  );

  const onPointerUpdate = useCallback(
    (p: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
      const now = Date.now();
      if (now - lastPointerSent.current < POINTER_EVERY_MS) return;
      lastPointerSent.current = now;
      void send({ t: 'pointer', x: p.pointer.x, y: p.pointer.y, tool: p.pointer.tool, button: p.button }, { lossy: true }).catch(() => {});
    },
    [send],
  );

  async function placePages(pages: RenderedPage[], kind: 'page' | 'image', name: string) {
    if (!api) return;
    const state: AppState = api.getAppState();
    const existing = api.getSceneElements();
    const bottom = existing.reduce((m, e) => Math.max(m, e.y + e.height), 0);
    const center = viewCenter({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height });
    const boxes =
      kind === 'page'
        ? layoutPages(pages, { x: 0, y: existing.length ? bottom + 160 : 0 })
        : [{ x: center.cx - pages[0].width / 4, y: center.cy - pages[0].height / 4, width: pages[0].width / 2, height: pages[0].height / 2 }];
    const pageOffset = frames.length;
    for (let i = 0; i < pages.length; i += 1) {
      if (kind === 'page') setProgress(t('board.adding', { n: i + 1, total: pages.length }));
      const { fileId, path } = await uploadBoardImage(lessonId, pages[i], kind, name);
      const dataURL = await blobToDataURL(pages[i].blob);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: 'image/webp', created: Date.now() }]);
      void send({ t: 'file', fileId, path, mime: 'image/webp', width: pages[i].width, height: pages[i].height }).catch(() => {});
      const imageId = crypto.randomUUID();
      const box = boxes[i];
      const skeleton =
        kind === 'page'
          ? [
              { type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId, locked: true },
              { type: 'frame' as const, children: [imageId], name: t('board.page', { n: pageOffset + i + 1 }), x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 },
            ]
          : [{ type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId }];
      const created = convertToExcalidrawElements(skeleton);
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    }
    setProgress(null);
  }

  async function onFile(file: File) {
    const check = checkUpload(file);
    if (!check.ok) return onError(check.reason);
    try {
      if (check.kind === 'pdf') {
        setProgress(t('board.adding', { n: 1, total: 1 }));
        await placePages(await renderPdf(file), 'page', file.name);
      } else {
        setProgress(t('board.addingImage'));
        await placePages([await imageToWebp(file)], 'image', file.name);
      }
    } catch (err) {
      onError(err instanceof PageLimitError ? 'board.tooManyPages' : 'board.uploadFailed');
    } finally {
      setProgress(null);
    }
  }

  const sortedFrames = [...frames].sort((a, b) => a.y - b.y);

  return (
    <div data-testid="board" className="relative h-full w-full">
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        onScrollChange={onScrollChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating
        theme={theme}
        langCode={locale === 'fr' ? 'fr-FR' : 'en'}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, changeViewBackgroundColor: false },
        }}
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
        <div className="pointer-events-auto">
          <AccentBar />
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {progress && <span role="status" className="card px-3 py-1.5 text-sm">{progress}</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current?.click()} disabled={progress !== null}>
            {t('board.insert')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </div>
      </div>

      {(sortedFrames.length > 1 || (member.role === 'student' && !follow.following)) && (
        <div className="absolute right-3 top-16 z-10 flex flex-col items-end gap-2">
          {member.role === 'student' && !follow.following && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => dispatchFollow({ type: 'resume' })}>
              {t('board.resume')}
            </button>
          )}
          {sortedFrames.length > 1 && (
            <nav aria-label={t('board.pages')} className="card flex flex-wrap gap-1 p-1">
              {sortedFrames.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  title={t('board.page', { n: i + 1 })}
                  onClick={() => api?.scrollToContent(f, { fitToContent: true, animate: true })}
                  className="min-w-8 rounded-md px-2 py-1 text-sm font-medium tabular-nums hover:bg-surface-2"
                >
                  {i + 1}
                </button>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

type BoardSend = ReturnType<typeof useBoardChannel>['send'];
type SaveQueue = ReturnType<typeof createSaveQueue>;

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
