'use client';

import '@excalidraw/excalidraw/index.css';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ClipboardData } from '@excalidraw/excalidraw/clipboard';
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, Collaborator, ExcalidrawImperativeAPI, ExcalidrawProps, NormalizedZoomValue, SocketId } from '@excalidraw/excalidraw/types';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useId, useImperativeHandle, useReducer, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { BACKUP_PREFIX, parseBackup, prunableBackupKeys, shouldWriteBackup } from '@/features/board/backup';
import { droppedFile, hasUnstoredImages, isFileDrag, sceneFileIds } from '@/features/board/files';
import { backupKey, loadBoard, loadDocumentFiles, loadFiles, saveBoard } from '@/features/board/persistence';
import type { BoardElement, BoardMessage } from '@/features/board/protocol';
import { imageToWebp, PageLimitError, renderPdf } from '@/features/board/render';
import { loadRetryDelay, withTimeout } from '@/features/board/retry';
import { createSaveQueue } from '@/features/board/saveQueue';
import { createDebounce, createThrottle, type Debounce, type Throttle } from '@/features/board/timing';
import { checkUpload, downloadAsDataURL, imageMime, isFilePathFor, isLessonPath, uploadBoardImage, type RenderedPage } from '@/features/board/upload';
import { DocumentPicker } from '@/features/documents/DocumentPicker';
import type { FileRow } from '@/features/documents/group';
import { addParam } from '@/features/documents/params';
import { classifyDriveFile, type DriveFile } from '@/features/drive/classify';
import { downloadDriveFile, openDrivePicker } from '@/features/drive/drive';
import { createDriveImport } from '@/features/drive/importFlow';
import { getDriveToken, preloadDriveAuth } from '@/features/drive/token';
import { useBoardChannel } from '@/features/board/useBoardChannel';
import { useThemeName } from '@/features/board/useThemeName';
import { adoptedElements, changedElements, markKnown, type KnownVersions } from '@/features/board/versions';
import { CloseIcon } from '@/features/room/icons';
import { isTypingElement } from '@/features/room/keys';
import { countPageFrames, followReducer, layoutPages, sceneBottom, scrollForCenter, viewCenter, viewportFor } from '@/features/board/view';
import { googleConfig } from '@/lib/env';
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
/** An image download that takes longer is given up (a later message or lookup retries it). */
const DOWNLOAD_TIMEOUT_MS = 20000;

/** Module-level so Excalidraw's memo sees the same object every render. */
const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, changeViewBackgroundColor: false },
  // Its images get SHA-1 ids and stay in this browser; ours are uploaded (Add menu, paste, drop).
  tools: { image: false },
} satisfies ExcalidrawProps['UIOptions'];

type PointerMessage = Extract<BoardMessage, { t: 'pointer' }>;
type SaveQueue = ReturnType<typeof createSaveQueue>;
type BoardSend = ReturnType<typeof useBoardChannel>['send'];
type LoadResult = 'loaded' | 'failed' | 'cancelled';

/** What RoomShell may ask of the board. */
export type BoardHandle = {
  /** Sends the last strokes and saves the scene now. True when everything is saved. */
  flush: () => Promise<boolean>;
};

function writeBackup(key: string, scene: { elements: readonly unknown[] }) {
  try {
    // savedAt lets a later visit drop backups that are a week old (prunableBackupKeys).
    localStorage.setItem(key, JSON.stringify({ elements: scene.elements, savedAt: Date.now() }));
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

/** Drops week-old and unreadable board backups of other lessons. */
function pruneBackups(keep: string) {
  try {
    const entries: [string, string | null][] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(BACKUP_PREFIX)) entries.push([k, localStorage.getItem(k)]);
    }
    for (const k of prunableBackupKeys(entries, Date.now(), keep)) localStorage.removeItem(k);
  } catch {
    // Blocked storage: nothing to prune.
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
  flushRef,
  onOpenMedia,
}: {
  lessonId: string;
  member: Member;
  visible: boolean;
  onError: (key: MessageKey) => void;
  /** Bring the board on stage (a document is being added from the Documents page). */
  onShow?: () => void;
  /** Filled with the board's handle, so End lesson can save the board first. */
  flushRef?: RefObject<BoardHandle | null>;
  /** An audio file picked in Google Drive: play it on the media stage. Without it, audio is refused. */
  onOpenMedia?: (m: { kind: 'audio'; drive: DriveFile }) => void;
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
  /** The load in progress, so a retry and a reconnect never run two loads at once. */
  const loading = useRef<Promise<LoadResult> | null>(null);
  const loadFailReported = useRef(false);
  /** Shown until the saved board loads after a failure: until then nothing is saved. */
  const [notSaved, setNotSaved] = useState(false);
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
  /** "From Google Drive" is in the Add menu only when Google is configured. */
  const driveEnabled = googleConfig() !== null;
  /** The Drive file whose download needs a new token; the Reconnect button retries it. */
  const [reauthFile, setReauthFile] = useState<DriveFile | null>(null);
  /** The latest progress, for a Drive pick that finishes after a paste or drop started another add. */
  const progressRef = useRef(progress);
  /** What the Drive import needs from the latest render: it outlives the click that started it. */
  const driveLive = useRef<{
    place: (file: File) => Promise<void>;
    openMedia?: (m: { kind: 'audio'; drive: DriveFile }) => void;
    toast: (key: MessageKey) => void;
    downloading: string;
  } | null>(null);
  /** True from the "From Google Drive" click until that import ends. */
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveImport] = useState(() =>
    createDriveImport({
      openPicker: () => openDrivePicker(),
      getToken: getDriveToken,
      download: (f) => downloadDriveFile(f),
      classify: classifyDriveFile,
      // onFile runs the upload's checks, progress and error toasts.
      place: (_kind, file) => driveLive.current?.place(file) ?? Promise.resolve(),
      get openMedia() {
        return driveLive.current?.openMedia;
      },
      toast: (key) => driveLive.current?.toast(key),
      askReconnect: setReauthFile,
      isAlive: () => mounted.current,
      isBusy: () => progressRef.current !== null,
      onBusyChange: setDriveBusy,
      setDownloading: (on) => setProgress(on ? (driveLive.current?.downloading ?? '') : null),
    }),
  );

  // Latest onError without re-running effects when the parent passes a new function.
  const reportError = useEffectEvent((key: MessageKey) => onError(key));
  // The same for callbacks handed to Excalidraw, which must stay stable (it re-renders on any new prop).
  const onErrorRef = useRef(onError);
  const visibleRef = useRef(visible);
  useEffect(() => {
    onErrorRef.current = onError;
    visibleRef.current = visible;
    progressRef.current = progress;
  });

  // Loads Google sign-in now, so the first "From Google Drive" click opens its pop-up inside the click.
  useEffect(() => {
    if (googleConfig()) void preloadDriveAuth();
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);

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
        const added = await withTimeout(
          downloadAsDataURL(path, mime).then((f) => {
            api.addFiles([{ id: fileId as FileId, dataURL: f.dataURL as BinaryFileData['dataURL'], mimeType: f.mime, created: Date.now() }]);
            return true;
          }),
          DOWNLOAD_TIMEOUT_MS,
          false,
        );
        if (!added) throw new Error('The image could not be downloaded in time');
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
      backup: (scene) => writeBackup(key, scene as { elements: readonly unknown[] }),
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
      sender.flush(); // the last strokes reach the queue, so hasUnsaved sees them
      // Never replace an older backup with a scene that does not contain it, and leave none behind
      // when everything is saved.
      if (!shouldWriteBackup({ loaded: loaded.current, backupMerged: backupMerged.current, unsaved: q.hasUnsaved() })) return;
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

  // Backups of other lessons that are a week old (or from before savedAt) would stay forever.
  useEffect(() => pruneBackups(backupKey(lessonId)), [lessonId]);

  // End lesson saves the board first.
  useImperativeHandle(
    flushRef,
    () => ({
      flush: async () => {
        elementSender.current?.flush(); // pushes the last strokes to the queue
        const q = queue.current;
        // Before the saved board is loaded nothing may be saved (it would replace the board with less).
        if (!q || !loaded.current) return false;
        return q.flush();
      },
    }),
    [],
  );

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
   * Loads the saved scene and any local backup. Elements are applied first and the board counts as
   * loaded at once; their images download in the background (applyRemote → fetchMissingFiles), so a
   * slow image never holds up saving. On failure, the backup is still merged locally (not saved),
   * so a later pagehide cannot replace it with less.
   */
  const loadScene = useCallback(
    async (isCancelled: () => boolean): Promise<LoadResult> => {
      if (!api) return 'cancelled';
      const key = backupKey(lessonId);
      try {
        const saved = await loadBoard(lessonId);
        if (isCancelled()) return 'cancelled';
        if (saved.length > 0) applyRemote(saved);
        loaded.current = true;
        const backup = readBackup(key);
        if (backup) {
          applyRemote(backup);
          backupMerged.current = true;
        }
        const all = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
        if (all.length > 0) {
          // Save now what was drawn before the load (or came from the backup): the save merges by element.
          queue.current?.push({ elements: all });
          // And send the merged scene to the other person once.
          markKnown(known.current, all);
          void send({ t: 'elements', elements: all }).catch(() => {});
        }
        return 'loaded';
      } catch {
        if (isCancelled()) return 'cancelled';
        if (!backupMerged.current) {
          const backup = readBackup(key);
          if (backup) applyRemote(backup); // not saved: loaded is still false
          backupMerged.current = true;
        }
        return 'failed';
      }
    },
    [api, lessonId, applyRemote, send],
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

  /** Runs one load, or joins the one in progress. Reports the first failure; shows board.notSaved until loaded. */
  const runLoad = useEffectEvent((isCancelled: () => boolean): Promise<LoadResult> => {
    if (loading.current) return loading.current;
    const run = loadScene(isCancelled)
      .then((result) => {
        if (result === 'loaded') {
          setNotSaved(false);
          addFromUrl();
        } else if (result === 'failed') {
          setNotSaved(true);
          if (!loadFailReported.current) {
            loadFailReported.current = true;
            reportError('board.loadFailed');
          }
        }
        return result;
      })
      .finally(() => {
        if (loading.current === run) loading.current = null;
      });
    loading.current = run;
    return run;
  });

  // First load, retried with backoff (5 s, 10 s, 20 s, then every 30 s) until it works: until then
  // nothing is saved. Then ask the other person for anything newer.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    loaded.current = false;
    backupMerged.current = false;
    loading.current = null;
    loadFailReported.current = false;
    // A new Excalidraw instance has no files yet.
    downloads.current.clear();
    lookedUp.current.clear();
    if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
    const attempt = (n: number) => {
      if (cancelled || loaded.current) return; // a reconnect may have loaded it meanwhile
      void runLoad(() => cancelled).then(() => {
        if (cancelled) return;
        if (n === 0) void send({ t: 'scene-req' }).catch(() => {});
        if (!loaded.current) retry = setTimeout(() => attempt(n + 1), loadRetryDelay(n));
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      loading.current = null; // the cancelled load must not block the next one
    };
  }, [api, lessonId, isStudent, send]);

  // After a reconnect: catch up both ways, save, and re-sync the follow view.
  const onReconnected = useEffectEvent(() => {
    if (!api) return;
    void (async () => {
      // Until the saved board loads, nothing is saved; try now that the connection is back.
      if (!loaded.current) await runLoad(() => !mounted.current);
      if (!mounted.current) return;
      void send({ t: 'scene-req' }).catch(() => {});
      const all = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
      markKnown(known.current, all);
      void send({ t: 'elements', elements: all }).catch(() => {});
      if (loaded.current) queue.current?.push({ elements: all });
      if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
    })();
  });
  // Connected, or the other person joined: ask again for their scene (and the teacher's view), in
  // case the first request went out before anyone was there to answer.
  const askPeer = useEffectEvent(() => {
    if (!api) return;
    void send({ t: 'scene-req' }).catch(() => {});
    if (isStudent) void send({ t: 'viewport-req' }).catch(() => {});
  });
  const onPeerLeft = useEffectEvent((p: RemoteParticipant) => {
    if (!collaborators.current.delete(p.identity as SocketId)) return;
    api?.updateScene({ collaborators: new Map(collaborators.current) });
  });
  useEffect(() => {
    const reconnected = () => onReconnected();
    const ask = () => askPeer();
    const left = (p: RemoteParticipant) => onPeerLeft(p);
    room.on(RoomEvent.Reconnected, reconnected);
    room.on(RoomEvent.Connected, ask);
    room.on(RoomEvent.ParticipantConnected, ask);
    room.on(RoomEvent.ParticipantDisconnected, left);
    return () => {
      room.off(RoomEvent.Reconnected, reconnected);
      room.off(RoomEvent.Connected, ask);
      room.off(RoomEvent.ParticipantConnected, ask);
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
      // The real type: Safari encodes PNG when asked for WebP.
      const { fileId, path, mime } = await uploadBoardImage(lessonId, pages[i], kind, name, { documentId, pageIndex: i });
      const dataURL = await blobToDataURL(pages[i].blob);
      api.addFiles([{ id: fileId as FileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: mime, created: Date.now() }]);
      void send({ t: 'file', fileId, path, mime, width: pages[i].width, height: pages[i].height }).catch(() => {});
      addPageElements(api, fileId, pages[i], kind, i, start);
    }
    setProgress(null);
  }

  /** Places an already uploaded document again (from the Documents library): same layout, no upload. */
  async function placeExisting(rows: FileRow[]) {
    if (!api) return;
    setMenuOpen(false);
    if (rows.length === 0) throw new Error('The document has no pages');
    const start = placementStart(api);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      setProgress(row.kind === 'page' ? t('board.adding', { n: i + 1, total: rows.length }) : t('board.addingImage'));
      await addFileFromStorage(row.id, row.storage_path, 'image/webp');
      // The type the download found (older uploads from Safari are PNG).
      const mime = imageMime(api.getFiles()[row.id]?.mimeType);
      void send({ t: 'file', fileId: row.id, path: row.storage_path, mime, width: row.width, height: row.height }).catch(() => {});
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
    setMenuOpen(false);
    const check = checkUpload(file);
    if (!check.ok) return onError(check.reason);
    try {
      if (check.kind === 'pdf') {
        // Rendering first ("Preparing page n of N"), then uploading ("Adding page n of N", in placePages).
        setProgress(t('board.preparing', { n: 1, total: '…' }));
        const pages = await renderPdf(file, (n, total) => setProgress(t('board.preparing', { n, total })));
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

  // The Drive import (importFlow) places files the upload's way, with this render's callbacks.
  useEffect(() => {
    driveLive.current = { place: onFile, openMedia: onOpenMedia, toast: onError, downloading: t('drive.downloading') };
  });

  // Pasted and dropped files go through our upload, so they are stored and reach the other person.
  // Excalidraw's own image tool is off (UIOptions.tools.image), and in 0.18.1 it handles a pasted image
  // file before calling onPaste, so files are caught here, in the capture phase, before it sees them.
  const onIncomingFile = useEffectEvent((file: File) => {
    // Still consumed while busy (the browser would open a dropped file), but say why nothing happened.
    if (progress !== null || driveImport.busy()) onError('board.busy');
    else void onFile(file);
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hasFiles = (e: DragEvent) => isFileDrag(e.dataTransfer?.types);
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const file = droppedFile(e.dataTransfer?.files);
      if (file) onIncomingFile(file);
    };
    const onPasteCapture = (e: ClipboardEvent) => {
      // Same target rule as Excalidraw: the board is on stage, has focus, and no text field is being edited.
      if (!visibleRef.current) return;
      const active = document.activeElement;
      if (!root.contains(active) || isTypingElement(active as HTMLElement | null)) return;
      const file = droppedFile(e.clipboardData?.files);
      if (!file) return; // text and copied elements: Excalidraw pastes them (see onPaste)
      e.preventDefault();
      e.stopPropagation();
      onIncomingFile(file);
    };
    root.addEventListener('dragover', onDragOver, true);
    root.addEventListener('drop', onDrop, true);
    window.addEventListener('paste', onPasteCapture, true);
    return () => {
      root.removeEventListener('dragover', onDragOver, true);
      root.removeEventListener('drop', onDrop, true);
      window.removeEventListener('paste', onPasteCapture, true);
    };
  }, []);

  // Copied elements whose images are not our uploads (e.g. from another Excalidraw) would never be stored or shared.
  const onPaste = useCallback(
    (data: ClipboardData) => {
      if (data.elements && hasUnstoredImages(data.elements)) {
        onErrorRef.current('board.pasteImages');
        return false;
      }
      return true;
    },
    [],
  );

  const sortedFrames = [...frames].sort((a, b) => a.y - b.y);

  return (
    <div ref={rootRef} data-testid="board" className="relative h-full w-full">
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        onScrollChange={onScrollChange}
        onPointerUpdate={onPointerUpdate}
        onPaste={onPaste}
        isCollaborating
        theme={theme}
        langCode={locale === 'fr' ? 'fr-FR' : 'en'}
        UIOptions={UI_OPTIONS}
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
        <div className="pointer-events-auto">
          <AccentBar />
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          {notSaved && (
            <span role="status" className="rounded-lg bg-pen-soft px-3 py-1.5 text-sm font-medium text-pen shadow-sm">
              {t('board.notSaved')}
            </span>
          )}
          {progress && <span role="status" className="card px-3 py-1.5 text-sm">{progress}</span>}
          {reauthFile && (
            <div role="status" className="card flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
              <span>{t('drive.reconnectNeeded')}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => reauthFile && driveImport.reconnect(reauthFile)}>
                {t('drive.reconnect')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" aria-label={t('common.dismiss')} onClick={() => setReauthFile(null)}>
                <CloseIcon />
              </button>
            </div>
          )}
          <AddMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            buttonRef={addButton}
            disabled={progress !== null}
            onUpload={() => fileInput.current?.click()}
            onDocuments={() => setPicking(true)}
            onDrive={driveEnabled ? driveImport.start : undefined}
            driveDisabled={driveBusy}
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

      {(sortedFrames.length > 1 || isStudent) && (
        <div className="absolute right-3 top-16 z-10 flex flex-col items-end gap-2">
          {isStudent && follow.following && (
            <span role="status" className="rounded-full bg-blue px-3 py-1 text-xs font-medium text-surface shadow-sm">
              {t('board.following')}
            </span>
          )}
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

/** The board's Add button: a small menu with Upload, From my documents and (when configured) From Google Drive. */
function AddMenu({
  open,
  onOpenChange: setOpen,
  buttonRef,
  disabled,
  onUpload,
  onDocuments,
  onDrive,
  driveDisabled,
}: {
  /** Owned by the Board, which closes the menu when an add starts (also by paste or drop). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onUpload: () => void;
  onDocuments: () => void;
  /** Hidden without it. Runs inside the click (choose calls it synchronously), for Google's pop-up. */
  onDrive?: () => void;
  /** A Drive import is running (one at a time). */
  driveDisabled?: boolean;
}) {
  const t = useT();
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
  }, [shown, buttonRef, setOpen]);

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
        // aria-disabled, not disabled: the button keeps focus while a document is being added.
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
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
          {onDrive && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              // aria-disabled keeps it in the arrow-key order while a Drive import is running.
              aria-disabled={driveDisabled || undefined}
              className={`${item} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
              onClick={() => {
                if (!driveDisabled) choose(onDrive);
              }}
            >
              {t('board.addFromDrive')}
            </button>
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
