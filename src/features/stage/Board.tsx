'use client';

import '@excalidraw/excalidraw/index.css';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, Collaborator, ExcalidrawImperativeAPI, NormalizedZoomValue, SocketId } from '@excalidraw/excalidraw/types';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { parseBackup } from '@/features/board/backup';
import { backupKey, loadBoard, saveBoard } from '@/features/board/persistence';
import type { BoardElement, BoardMessage } from '@/features/board/protocol';
import { imageToWebp, PageLimitError, renderPdf } from '@/features/board/render';
import { createSaveQueue } from '@/features/board/saveQueue';
import { createDebounce, createThrottle, type Debounce, type Throttle } from '@/features/board/timing';
import { checkUpload, downloadAsDataURL, isLessonPath, uploadBoardImage, type RenderedPage } from '@/features/board/upload';
import { useBoardChannel } from '@/features/board/useBoardChannel';
import { adoptedElements, changedElements, markKnown, type KnownVersions } from '@/features/board/versions';
import { countPageFrames, followReducer, layoutPages, sceneBottom, scrollForCenter, viewCenter } from '@/features/board/view';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Member } from '@/lib/lessons/types';

const SEND_EVERY_MS = 50;
const SEND_MAX_WAIT_MS = 150;
const VIEWPORT_EVERY_MS = 100;
const POINTER_EVERY_MS = 50;
/** Space above the first inserted page, and between page images (as in layoutPages: 80 px, frames add 20 each side). */
const FIRST_PAGE_GAP = 160;
const NEXT_PAGE_GAP = 60;

type PointerMessage = Extract<BoardMessage, { t: 'pointer' }>;
type SaveQueue = ReturnType<typeof createSaveQueue>;
type BoardSend = ReturnType<typeof useBoardChannel>['send'];

function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' || (!attr && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function useThemeName(): 'light' | 'dark' {
  // Read synchronously on first render (Board is client-only) so dark mode does not flash.
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const read = () => setTheme(readTheme());
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

function writeBackup(key: string, scene: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(scene));
  } catch {
    // Storage full or blocked: the save retry still runs.
  }
}

function readBackup(key: string): BoardElement[] | null {
  try {
    return parseBackup(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function removeBackup(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Blocked storage: nothing to remove.
  }
}

function viewportOf(api: ExcalidrawImperativeAPI): BoardMessage {
  const s = api.getAppState();
  const c = viewCenter({ scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value, width: s.width, height: s.height });
  return { t: 'viewport', cx: c.cx, cy: c.cy, zoom: s.zoom.value };
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
  const room = useRoomContext();
  const isStudent = member.role === 'student';
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const known = useRef<KnownVersions>(new Map());
  /** The scene as of the last onChange (Excalidraw clears its own scene on unmount). */
  const latest = useRef<readonly OrderedExcalidrawElement[]>([]);
  /** True once the saved board is loaded; until then nothing is saved, so a partial scene never overwrites it. */
  const loaded = useRef(false);
  const queue = useRef<SaveQueue | null>(null);
  const elementSender = useRef<Debounce | null>(null);
  const viewportSender = useRef<Throttle<null> | null>(null);
  const pointerSender = useRef<Throttle<PointerMessage> | null>(null);
  const lastButton = useRef<'up' | 'down'>('up');
  const collaborators = useRef(new Map<SocketId, Collaborator>());
  const [follow, dispatchFollow] = useReducer(followReducer, { following: isStudent, lastApplied: null });
  const [progress, setProgress] = useState<string | null>(null);
  const [frames, setFrames] = useState<ExcalidrawElement[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Latest onError without re-running effects when the parent passes a new function.
  const reportError = useEffectEvent((key: MessageKey) => onError(key));

  const addFileFromStorage = useCallback(
    async (fileId: string, path: string, mime: string) => {
      if (!api || api.getFiles()[fileId]) return;
      const dataURL = await downloadAsDataURL(path);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: mime as BinaryFileData['mimeType'], created: Date.now() }]);
    },
    [api],
  );

  const applyRemote = useCallback(
    (remote: readonly BoardElement[]) => {
      if (!api) return;
      let restored: OrderedExcalidrawElement[];
      try {
        // Repairs malformed peer data. Local elements are deliberately not passed: with them,
        // restoreElements bumps a stale remote element above a newer local one.
        restored = restoreElements(remote as unknown as readonly ExcalidrawElement[], null);
      } catch {
        return;
      }
      const merged = reconcileElements(
        api.getSceneElementsIncludingDeleted() as OrderedExcalidrawElement[],
        restored as unknown as RemoteExcalidrawElement[],
        api.getAppState(),
      );
      markKnown(known.current, adoptedElements(merged, restored));
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
      // saveBoard writes the whole scene, so remote changes must be saved too.
      if (loaded.current) queue.current?.push({ elements: api.getSceneElementsIncludingDeleted() });
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
      case 'viewport-req':
        if (!isStudent) void sendRef.current?.(viewportOf(api), { to: [from] }).catch(() => {});
        break;
      case 'file':
        if (isLessonPath(lessonId, msg.path)) void addFileFromStorage(msg.fileId, msg.path, msg.mime).catch(() => {});
        break;
      case 'viewport': {
        if (!isStudent || !follow.following) break;
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
          username: room.getParticipantByIdentity(from)?.name || from,
        });
        api.updateScene({ collaborators: new Map(collaborators.current) });
        break;
      }
    }
  });
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Saving and element sending. Created in an effect so a StrictMode remount gets fresh, undisposed ones.
  useEffect(() => {
    const key = backupKey(lessonId);
    const q = createSaveQueue({
      save: async (scene) => {
        await saveBoard(lessonId, member.email, (scene as { elements: BoardElement[] }).elements);
        removeBackup(key);
      },
      backup: (scene) => writeBackup(key, scene),
      onFailures: (n) => {
        if (n === 3) reportError('board.saveFailed');
      },
    });
    const sender = createDebounce(
      () => {
        const all = latest.current as unknown as BoardElement[];
        const changed = changedElements(known.current, all);
        if (changed.length === 0) return;
        markKnown(known.current, changed);
        void send({ t: 'elements', elements: changed }).catch(() => {});
        if (loaded.current) q.push({ elements: all });
      },
      SEND_EVERY_MS,
      SEND_MAX_WAIT_MS,
    );
    const onPageHide = () => {
      if (latest.current.length > 0) writeBackup(key, { elements: latest.current });
    };
    window.addEventListener('pagehide', onPageHide);
    queue.current = q;
    elementSender.current = sender;
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (queue.current === q) queue.current = null;
      if (elementSender.current === sender) elementSender.current = null;
      sender.flush(); // send the last strokes now
      if (loaded.current) q.push({ elements: latest.current });
      void q.flush().finally(() => q.dispose());
    };
  }, [lessonId, member.email, send]);

  // Pointer (laser) and, for the teacher, viewport broadcasting.
  useEffect(() => {
    if (!api) return;
    const pointer = createThrottle<PointerMessage>(
      (m, kind) => void send(m, { lossy: kind !== 'now' }).catch(() => {}),
      POINTER_EVERY_MS,
    );
    pointerSender.current = pointer;
    let viewport: Throttle<null> | null = null;
    let resize: ResizeObserver | null = null;
    if (!isStudent) {
      // Leading send is lossy; the trailing one carries the final position reliably.
      const vp = createThrottle<null>(
        (_, kind) => void send(viewportOf(api), { lossy: kind === 'leading' }).catch(() => {}),
        VIEWPORT_EVERY_MS,
        { alwaysTrailing: true },
      );
      viewport = vp;
      viewportSender.current = vp;
      // onScrollChange does not fire on resize, but the view centre moves.
      resize = new ResizeObserver(() => vp.call(null));
      if (rootRef.current) resize.observe(rootRef.current);
    }
    return () => {
      pointer.cancel();
      if (pointerSender.current === pointer) pointerSender.current = null;
      viewport?.cancel();
      if (viewport && viewportSender.current === viewport) viewportSender.current = null;
      resize?.disconnect();
    };
  }, [api, isStudent, send]);

  // First load: the saved scene, its images and any local backup; then ask the other person for anything newer.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    loaded.current = false;
    if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
    (async () => {
      try {
        const saved = await loadBoard(lessonId);
        if (cancelled) return;
        await Promise.all(saved.files.map((f) => addFileFromStorage(f.id, f.storage_path, f.mime).catch(() => {})));
        if (cancelled) return;
        if (saved.elements.length > 0) applyRemote(saved.elements);
        loaded.current = true;
        const backup = readBackup(backupKey(lessonId));
        if (backup) {
          applyRemote(backup); // also pushes the merged scene to the save queue
          const all = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
          markKnown(known.current, all);
          void send({ t: 'elements', elements: all }).catch(() => {});
        }
      } catch {
        if (cancelled) return;
        reportError('board.loadFailed');
      }
      void send({ t: 'scene-req' }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [api, lessonId, isStudent, addFileFromStorage, applyRemote, send]);

  // After a reconnect: catch up both ways, save, and re-sync the follow view.
  const onReconnected = useEffectEvent(() => {
    if (!api) return;
    void send({ t: 'scene-req' }).catch(() => {});
    const all = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
    markKnown(known.current, all);
    void send({ t: 'elements', elements: all }).catch(() => {});
    if (loaded.current) queue.current?.push({ elements: all });
    if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
  });
  const onPeerLeft = useEffectEvent((p: RemoteParticipant) => {
    if (!collaborators.current.delete(p.identity as SocketId)) return;
    api?.updateScene({ collaborators: new Map(collaborators.current) });
  });
  useEffect(() => {
    const reconnected = () => onReconnected();
    const left = (p: RemoteParticipant) => onPeerLeft(p);
    room.on(RoomEvent.Reconnected, reconnected);
    room.on(RoomEvent.ParticipantDisconnected, left);
    return () => {
      room.off(RoomEvent.Reconnected, reconnected);
      room.off(RoomEvent.ParticipantDisconnected, left);
    };
  }, [room]);

  // A hidden Excalidraw has zero size; re-measure when it becomes visible.
  useEffect(() => {
    if (visible) api?.refresh();
  }, [visible, api]);

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    latest.current = elements;
    const nextFrames = elements.filter((e) => e.type === 'frame' && !e.isDeleted);
    // onChange fires on every pointer move; only re-render when the frames really changed.
    setFrames((prev) =>
      prev.length === nextFrames.length && prev.every((f, i) => f.id === nextFrames[i].id && f.version === nextFrames[i].version)
        ? prev
        : nextFrames,
    );
    elementSender.current?.call();
  }, []);

  const onScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      if (isStudent) {
        dispatchFollow({ type: 'scrolled', scrollX, scrollY, zoom: zoom.value });
        return;
      }
      viewportSender.current?.call(null);
    },
    [isStudent],
  );

  const onPointerUpdate = useCallback(
    (p: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
      const sender = pointerSender.current;
      if (!sender) return;
      const m: PointerMessage = { t: 'pointer', x: p.pointer.x, y: p.pointer.y, tool: p.pointer.tool, button: p.button };
      if (p.button !== lastButton.current) {
        // Laser on/off must arrive at once and reliably.
        lastButton.current = p.button;
        sender.now(m);
      } else {
        sender.call(m);
      }
    },
    [],
  );

  async function placePages(pages: RenderedPage[], kind: 'page' | 'image', name: string) {
    if (!api) return;
    const state: AppState = api.getAppState();
    const center = viewCenter({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height });
    const pageOffset = countPageFrames(api.getSceneElements(), t('board.page'));
    for (let i = 0; i < pages.length; i += 1) {
      if (kind === 'page') setProgress(t('board.adding', { n: i + 1, total: pages.length }));
      const { fileId, path } = await uploadBoardImage(lessonId, pages[i], kind, name);
      const dataURL = await blobToDataURL(pages[i].blob);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: 'image/webp', created: Date.now() }]);
      void send({ t: 'file', fileId, path, mime: 'image/webp', width: pages[i].width, height: pages[i].height }).catch(() => {});
      const imageId = crypto.randomUUID();
      let skeleton;
      if (kind === 'page') {
        // Measured per page, so pages land below whatever is on the board now (including the other person's strokes).
        const bottom = sceneBottom(api.getSceneElements());
        const box = layoutPages([pages[i]], { x: 0, y: bottom === null ? 0 : bottom + (i === 0 ? FIRST_PAGE_GAP : NEXT_PAGE_GAP) })[0];
        skeleton = [
          { type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId, locked: true },
          { type: 'frame' as const, children: [imageId], name: t('board.page', { n: pageOffset + i + 1 }), x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 },
        ];
      } else {
        const box = { x: center.cx - pages[0].width / 4, y: center.cy - pages[0].height / 4, width: pages[0].width / 2, height: pages[0].height / 2 };
        skeleton = [{ type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId }];
      }
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
        const pages = await renderPdf(file, (n, total) => setProgress(t('board.adding', { n, total })));
        await placePages(pages, 'page', file.name);
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
    <div ref={rootRef} data-testid="board" className="relative h-full w-full">
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

      {(sortedFrames.length > 1 || (isStudent && !follow.following)) && (
        <div className="absolute right-3 top-16 z-10 flex flex-col items-end gap-2">
          {isStudent && !follow.following && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                dispatchFollow({ type: 'resume' });
                void send({ t: 'viewport-req' }).catch(() => {});
              }}
            >
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

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
