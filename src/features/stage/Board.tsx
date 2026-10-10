'use client';

import '@excalidraw/excalidraw/index.css';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, Collaborator, ExcalidrawImperativeAPI, NormalizedZoomValue, SocketId } from '@excalidraw/excalidraw/types';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useId, useReducer, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { parseBackup, shouldWriteBackup } from '@/features/board/backup';
import { sceneFileIds } from '@/features/board/files';
import { backupKey, loadBoard, loadDocumentFiles, loadFiles, saveBoard } from '@/features/board/persistence';
import type { BoardElement, BoardMessage } from '@/features/board/protocol';
import { imageToWebp, PageLimitError, renderPdf } from '@/features/board/render';
import { createSaveQueue } from '@/features/board/saveQueue';
import { createDebounce, createThrottle, type Debounce, type Throttle } from '@/features/board/timing';
import { checkUpload, downloadAsDataURL, isFilePathFor, isLessonPath, uploadBoardImage, type RenderedPage } from '@/features/board/upload';
import { DocumentPicker } from '@/features/documents/DocumentPicker';
import type { FileRow } from '@/features/documents/group';
import { addParam } from '@/features/documents/params';
import { useBoardChannel } from '@/features/board/useBoardChannel';
import { adoptedElements, changedElements, markKnown, type KnownVersions } from '@/features/board/versions';
import { countPageFrames, followReducer, layoutPages, sceneBottom, scrollForCenter, viewCenter, viewportFor } from '@/features/board/view';
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

/** The current viewport message, or null while the board is hidden (zero size). */
function viewportOf(api: ExcalidrawImperativeAPI): BoardMessage | null {
  const s = api.getAppState();
  const v = viewportFor({ scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value, width: s.width, height: s.height });
  return v && { t: 'viewport', ...v };
}

export default function Board({
  lessonId,
  member,
  visible,
  onError,
  onShow,
}: {
  lessonId: string;
  member: Member;
  visible: boolean;
  onError: (key: MessageKey) => void;
  /** Bring the board on stage (a document is being added from the Documents page). */
  onShow?: () => void;
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
  /** True once the localStorage backup is in the scene (after a failed load), so pagehide may replace it. */
  const backupMerged = useRef(false);
  const loadFailed = useRef(false);
  const mounted = useRef(true);
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
  const addButton = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  // Latest onError without re-running effects when the parent passes a new function.
  const reportError = useEffectEvent((key: MessageKey) => onError(key));

  /** Image downloads in flight, so a `file` message and a missing-file lookup never fetch one twice. */
  const downloads = useRef(new Map<string, Promise<void>>());
  /** File ids already looked up by fetchMissingFiles (each is tried once per mount). */
  const lookedUp = useRef(new Set<string>());

  const addFileFromStorage = useCallback(
    (fileId: string, path: string, mime: string): Promise<void> => {
      if (!api || api.getFiles()[fileId]) return Promise.resolve();
      const running = downloads.current.get(fileId);
      if (running) return running;
      const download = (async () => {
        const dataURL = await downloadAsDataURL(path);
        api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: mime as BinaryFileData['mimeType'], created: Date.now() }]);
      })().finally(() => {
        if (downloads.current.get(fileId) === download) downloads.current.delete(fileId);
      });
      downloads.current.set(fileId, download);
      return download;
    },
    [api],
  );

  /**
   * Images whose file this board does not have yet: a backup or the other person's scene can use
   * files the saved scene does not (e.g. a document re-used from an older lesson, not saved yet).
   */
  const fetchMissingFiles = useCallback(
    (elements: readonly object[]) => {
      if (!api) return;
      const have = api.getFiles();
      const ids = sceneFileIds(elements).filter((id) => !have[id] && !downloads.current.has(id) && !lookedUp.current.has(id));
      if (ids.length === 0) return;
      for (const id of ids) lookedUp.current.add(id);
      void loadFiles(ids)
        .then((files) => Promise.all(files.map((f) => addFileFromStorage(f.id, f.storage_path, f.mime))))
        .catch(() => {
          for (const id of ids) lookedUp.current.delete(id); // a later message retries
        });
    },
    [api, addFileFromStorage],
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
      fetchMissingFiles(restored);
      // saveBoard writes the whole scene, so remote changes must be saved too.
      if (loaded.current) queue.current?.push({ elements: api.getSceneElementsIncludingDeleted() });
    },
    [api, fetchMissingFiles],
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
      case 'viewport-req': {
        const vp = isStudent ? null : viewportOf(api);
        if (vp) void sendRef.current?.(vp, { to: [from] }).catch(() => {});
        break;
      }
      case 'file':
        if (isLessonPath(lessonId, msg.path) || isFilePathFor(msg.fileId, msg.path)) void addFileFromStorage(msg.fileId, msg.path, msg.mime).catch(() => {});
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
      // Never replace an older backup with a scene that does not contain it.
      if (!shouldWriteBackup({ loaded: loaded.current, backupMerged: backupMerged.current })) return;
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
        (_, kind) => {
          const vp = viewportOf(api);
          if (vp) void send(vp, { lossy: kind === 'leading' }).catch(() => {});
        },
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Loads the saved scene, its images and any local backup. On failure, the backup is still merged
   * locally (not saved), so a later pagehide cannot replace it with less. The caller reports 'failed'.
   */
  const loadScene = useCallback(
    async (isCancelled: () => boolean): Promise<'loaded' | 'failed' | 'cancelled'> => {
      if (!api) return 'cancelled';
      const key = backupKey(lessonId);
      try {
        const saved = await loadBoard(lessonId);
        if (isCancelled()) return 'cancelled';
        await Promise.all(saved.files.map((f) => addFileFromStorage(f.id, f.storage_path, f.mime).catch(() => {})));
        if (isCancelled()) return 'cancelled';
        if (saved.elements.length > 0) applyRemote(saved.elements);
        loaded.current = true;
        loadFailed.current = false;
        const backup = readBackup(key);
        if (backup) {
          applyRemote(backup); // also pushes the merged scene to the save queue
          backupMerged.current = true;
          const all = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
          markKnown(known.current, all);
          void send({ t: 'elements', elements: all }).catch(() => {});
        }
        return 'loaded';
      } catch {
        if (isCancelled()) return 'cancelled';
        loadFailed.current = true;
        if (!backupMerged.current) {
          const backup = readBackup(key);
          if (backup) applyRemote(backup); // not saved: loaded is still false
          backupMerged.current = true;
        }
        return 'failed';
      }
    },
    [api, lessonId, addFileFromStorage, applyRemote, send],
  );

  // `?add=<documentId>` (from the Documents page): place that document once, after the board has loaded.
  const addHandled = useRef(false);
  const addFromUrl = useEffectEvent(() => {
    if (addHandled.current) return;
    const id = addParam(location.search);
    if (!id) return;
    addHandled.current = true;
    // Drop the param at once, so a reload during the placement cannot add the document twice.
    history.replaceState(null, '', location.pathname);
    onShow?.();
    void (async () => {
      try {
        await placeExisting(await loadDocumentFiles(id));
      } catch {
        onError('board.uploadFailed');
      } finally {
        setProgress(null);
      }
    })();
  });

  // First load; then ask the other person for anything newer.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    loaded.current = false;
    backupMerged.current = false;
    loadFailed.current = false;
    // A new Excalidraw instance has no files yet.
    downloads.current.clear();
    lookedUp.current.clear();
    if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
    void loadScene(() => cancelled).then((result) => {
      if (cancelled) return;
      if (result === 'failed') reportError('board.loadFailed');
      if (result === 'loaded') addFromUrl();
      void send({ t: 'scene-req' }).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [api, isStudent, loadScene, send]);

  // After a reconnect: catch up both ways, save, and re-sync the follow view.
  const onReconnected = useEffectEvent(() => {
    if (!api) return;
    void (async () => {
      // A failed first load disables saving; retry it now that the connection is back.
      if (!loaded.current && loadFailed.current) {
        const result = await loadScene(() => !mounted.current);
        if (result === 'failed') reportError('board.loadFailed');
        if (result === 'loaded') addFromUrl();
      }
      if (!mounted.current) return;
      void send({ t: 'scene-req' }).catch(() => {});
      const all = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
      markKnown(known.current, all);
      void send({ t: 'elements', elements: all }).catch(() => {});
      if (loaded.current) queue.current?.push({ elements: all });
      if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
    })();
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

  // A hidden Excalidraw has zero size; re-measure when it becomes visible, and (teacher) send the view
  // that was skipped while hidden. The throttle's reliable trailing send reads the re-measured size.
  useEffect(() => {
    if (!visible || !api) return;
    api.refresh();
    if (!isStudent) viewportSender.current?.call(null);
    // Student: viewports received while hidden were applied at size 0, so ask the teacher for a fresh one.
    else void send({ t: 'viewport-req' }).catch(() => {});
  }, [visible, api, isStudent, send]);

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

  /** Where new pages go: the view centre (images) and the page number to continue from (PDF frames). */
  function placementStart(a: ExcalidrawImperativeAPI) {
    const state: AppState = a.getAppState();
    return {
      center: viewCenter({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height }),
      pageOffset: countPageFrames(a.getSceneElements(), t('board.page')),
    };
  }

  /**
   * Adds the elements for page `i` of a placement: a PDF page becomes a locked image in a frame,
   * stacked below the scene; an image goes at the view centre.
   */
  function addPageElements(
    a: ExcalidrawImperativeAPI,
    fileId: string,
    size: { width: number; height: number },
    kind: 'page' | 'image',
    i: number,
    start: ReturnType<typeof placementStart>,
  ) {
    const imageId = crypto.randomUUID();
    let skeleton;
    if (kind === 'page') {
      // Measured per page, so pages land below whatever is on the board now (including the other person's strokes).
      const bottom = sceneBottom(a.getSceneElements());
      const box = layoutPages([size], { x: 0, y: bottom === null ? 0 : bottom + (i === 0 ? FIRST_PAGE_GAP : NEXT_PAGE_GAP) })[0];
      skeleton = [
        { type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId, locked: true },
        { type: 'frame' as const, children: [imageId], name: t('board.page', { n: start.pageOffset + i + 1 }), x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 },
      ];
    } else {
      const { center } = start;
      const box = { x: center.cx - size.width / 4, y: center.cy - size.height / 4, width: size.width / 2, height: size.height / 2 };
      skeleton = [{ type: 'image' as const, id: imageId, x: box.x, y: box.y, width: box.width, height: box.height, fileId: fileId as FileId }];
    }
    const created = convertToExcalidrawElements(skeleton);
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  async function placePages(pages: RenderedPage[], kind: 'page' | 'image', name: string) {
    if (!api) return;
    const start = placementStart(api);
    // One id for all pages of this upload, so the Documents page shows them as one document.
    const documentId = crypto.randomUUID();
    for (let i = 0; i < pages.length; i += 1) {
      if (kind === 'page') setProgress(t('board.adding', { n: i + 1, total: pages.length }));
      const { fileId, path } = await uploadBoardImage(lessonId, pages[i], kind, name, { documentId, pageIndex: i });
      const dataURL = await blobToDataURL(pages[i].blob);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: 'image/webp', created: Date.now() }]);
      void send({ t: 'file', fileId, path, mime: 'image/webp', width: pages[i].width, height: pages[i].height }).catch(() => {});
      addPageElements(api, fileId, pages[i], kind, i, start);
    }
    setProgress(null);
  }

  /** Places an already uploaded document again (from the Documents library): same layout, no upload. */
  async function placeExisting(rows: FileRow[]) {
    if (!api) return;
    if (rows.length === 0) throw new Error('The document has no pages');
    const start = placementStart(api);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      setProgress(row.kind === 'page' ? t('board.adding', { n: i + 1, total: rows.length }) : t('board.addingImage'));
      await addFileFromStorage(row.id, row.storage_path, 'image/webp');
      void send({ t: 'file', fileId: row.id, path: row.storage_path, mime: 'image/webp', width: row.width, height: row.height }).catch(() => {});
      addPageElements(api, row.id, row, row.kind, i, start);
    }
    setProgress(null);
  }

  function pickDocument(rows: FileRow[]) {
    setPicking(false);
    void placeExisting(rows)
      .catch(() => onError('board.uploadFailed'))
      .finally(() => setProgress(null));
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
          <AddMenu
            buttonRef={addButton}
            disabled={progress !== null}
            onUpload={() => fileInput.current?.click()}
            onDocuments={() => setPicking(true)}
          />
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

      {picking && (
        <DocumentPicker onPick={(d) => pickDocument(d.pages)} onClose={() => setPicking(false)} returnFocus={() => addButton.current} />
      )}
    </div>
  );
}

/** The board's Add button: a small menu with Upload and From my documents. */
function AddMenu({
  buttonRef,
  disabled,
  onUpload,
  onDocuments,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onUpload: () => void;
  onDocuments: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const shown = open && !disabled;

  useEffect(() => {
    if (!shown) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [shown, buttonRef]);

  function choose(action: () => void) {
    setOpen(false);
    buttonRef.current?.focus(); // the file chooser and the picker hand focus back here
    action();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const item = 'rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-surface-2 focus-visible:bg-surface-2';
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {t('board.add')}
        <svg aria-hidden viewBox="0 0 12 12" className={`size-3 transition-transform ${shown ? '' : 'rotate-180'}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {shown && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('board.add')}
          onKeyDown={onKeyDown}
          className="card absolute bottom-full right-0 mb-2 flex w-max min-w-52 max-w-[calc(100vw-1.5rem)] flex-col p-1 shadow-lg"
        >
          <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={() => choose(onUpload)}>
            {t('board.addUpload')}
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={() => choose(onDocuments)}>
            {t('board.addFromDocuments')}
          </button>
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
