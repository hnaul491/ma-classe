'use client';

import dynamic from 'next/dynamic';
import { RoomAudioRenderer, useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { RoomEvent, Track, type LocalTrackPublication, type Participant, type RemoteTrackPublication } from 'livekit-client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { endLesson } from '@/app/actions';
import { isFileDrag } from '@/features/board/files';
import { withTimeout } from '@/features/board/retry';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { ChatToast } from '@/features/chat/ChatToast';
import { chatButtonAction, chatSeen, initialToast, previewText, shouldNotify, toastReducer } from '@/features/chat/notify';
import { playDing, useAudioUnlock, useChatMuted } from '@/features/chat/sound';
import { useChat } from '@/features/chat/useChat';
import { useTabHidden } from '@/features/chat/useTabHidden';
import { useTabTitle } from '@/features/chat/useTabTitle';
import type { DriveFile } from '@/features/drive/classify';
import type { BoardHandle } from '@/features/stage/Board';
import type { MediaHandle } from '@/features/stage/MediaStage';
import { CameraTiles } from '@/features/stage/CameraTiles';
import { ScreenView } from '@/features/stage/ScreenView';
import { useT } from '@/lib/i18n/client';
import type { Stage, SyncMessage } from '@/features/sync/protocol';
import { useSync } from '@/features/sync/useSync';
import { useVocab } from '@/features/vocab/useVocab';
import { VocabPanel } from '@/features/vocab/VocabPanel';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Member } from '@/lib/lessons/types';
import { ControlBar } from './ControlBar';
import { FloatingCams } from './FloatingCams';
import { ExitFullscreenIcon, FullscreenIcon } from './icons';
import { fullscreenKeyEnabled, isUserCancel } from './keys';
import { SCREEN_CAPTURE } from './roomOptions';
import { SidePanel, type SideTab } from './SidePanel';
import {
  applyRemoteStage,
  initialStage,
  localStageChange,
  resolveVisibleStage,
  shouldStopLocalShare,
  stageAfterLocalShareEnded,
  type StageState,
} from './stage';
import { StatusBar, useReconnectingSince } from './StatusBar';
import { useAutoHide } from './useAutoHide';
import { useFullscreen } from './useFullscreen';
import { useMediaQuery } from './useMediaQuery';
import { useToast } from './useToast';

const Board = dynamic(() => import('@/features/stage/Board'), { ssr: false });
const MediaStage = dynamic(() => import('@/features/stage/MediaStage'), { ssr: false });

/** End lesson waits this long for the board to save, then ends anyway. */
const END_FLUSH_TIMEOUT_MS = 4000;

const AVAILABLE: readonly Stage[] = ['cameras', 'board', 'screen', 'media'];
const STAGE_KEY: Record<Stage, MessageKey> = {
  cameras: 'stage.cameras',
  board: 'stage.board',
  screen: 'stage.screen',
  media: 'stage.media',
};

export function RoomShell({
  lessonId,
  member,
  planBUrl,
  startedAt,
}: {
  lessonId: string;
  member: Member;
  planBUrl: string;
  startedAt: string;
}) {
  const t = useT();
  const room = useRoomContext();
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const [stage, setStage] = useState<StageState>(initialStage);
  const stageRef = useRef(stage);
  const { message: toastMessage, show: showToast } = useToast();
  const board = useRef<BoardHandle | null>(null);
  const media = useRef<MediaHandle | null>(null);
  const visible = resolveVisibleStage(stage.stage, { screenActive: screenTracks.length > 0, available: AVAILABLE });
  const { ref: fsRef, active: fsActive, toggle: toggleFs } = useFullscreen<HTMLDivElement>(fullscreenKeyEnabled(visible));
  const { visible: barVisible, poke: pokeBar } = useAutoHide(fsActive);
  const reconnectingSince = useReconnectingSince();
  // Personal: each person opens and closes their own chat; it is not synced.
  // On board, screen and media stages (outside fullscreen, from lg up) the chat is docked under the cameras and
  // open by default; the Chat button folds it. Elsewhere it is the overlay panel, closed by default.
  const wide = useMediaQuery('(min-width: 1024px)');
  const railShown = visible !== 'cameras' && !fsActive;
  const docked = railShown && wide;
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [dockFolded, setDockFolded] = useState(false);
  const chatOpen = docked ? !dockFolded : overlayOpen;
  // The side panel shows the chat or the lesson's vocabulary; personal too, and kept when the panel closes.
  const [sideTab, setSideTab] = useState<SideTab>('chat');
  const [draft, setDraft] = useState('');
  // Set when the Chat button or the new-message toast brings the chat on screen: the message box takes the
  // cursor then. A tab switch never sets it, so the focus stays on the tab.
  const [chatFocusPending, setChatFocusPending] = useState(false);
  useAudioUnlock();
  const tabHidden = useTabHidden();
  // Read only while the panel is open on the Chat tab and the browser tab is in view.
  const seen = chatSeen({ open: chatOpen, hidden: tabHidden, tab: sideTab });
  // A word the other person adds or edits marks the Vocabulary tab until it is looked at.
  const [vocabNew, setVocabNew] = useState(false);
  const vocabShown = chatOpen && sideTab === 'vocab';
  if (vocabShown && vocabNew) setVocabNew(false);
  const vocab = useVocab(lessonId, member, () => {
    if (!vocabShown) setVocabNew(true);
  });
  const [toast, dispatchToast] = useReducer(toastReducer, initialToast);
  const [chatMuted, toggleChatMuted] = useChatMuted();
  const chat = useChat(lessonId, member, (m) => {
    if (!shouldNotify({ fromSelf: m.authorEmail.toLowerCase() === member.email.toLowerCase(), panelOpen: seen })) return;
    dispatchToast({ type: 'new', name: m.authorName, text: previewText(m.body) });
    void playDing();
  });
  const chatUnseen = seen ? 0 : chat.unread;
  useTabTitle(chatUnseen);
  const chatButton = useRef<HTMLButtonElement>(null);
  const { markRead } = chat;
  const chatShown = chatOpen && sideTab === 'chat';
  // The Chat button. With messages unread it always shows the chat (opening the panel or switching tab, never
  // folding it); the `seen` effects below then mark them read and drop the toast.
  // Otherwise it opens or folds the panel, which keeps its tab. On the Chat tab, opening shows everything and
  // closing counts what arrived while it was open as read; on the Vocabulary tab the chat stays as it was.
  const toggleChat = useCallback(() => {
    if (chatButtonAction({ open: chatOpen, tab: sideTab, unread: chatUnseen }) === 'open-chat') {
      if (docked) setDockFolded(false);
      else setOverlayOpen(true);
      setSideTab('chat');
      setChatFocusPending(true);
      return;
    }
    if (docked) setDockFolded((f) => !f);
    else setOverlayOpen((o) => !o);
    if (sideTab !== 'chat') return;
    // Opening puts the cursor in the message box.
    if (!chatOpen) setChatFocusPending(true);
    dispatchToast({ type: 'open' });
    markRead();
  }, [chatOpen, chatUnseen, docked, markRead, sideTab]);
  // The toast always leads to the chat, whatever tab the panel was on.
  const openChatFromToast = useCallback(() => {
    if (docked) setDockFolded(false);
    else setOverlayOpen(true);
    setSideTab('chat');
    setChatFocusPending(true);
    dispatchToast({ type: 'open' });
    markRead();
  }, [docked, markRead]);
  const dismissToast = useCallback(() => dispatchToast({ type: 'dismiss' }), []);
  const closeToast = useCallback(() => {
    dispatchToast({ type: 'dismiss' });
    chatButton.current?.focus();
  }, []);
  // Messages that arrive while the dock is on screen are read as they come.
  useEffect(() => {
    if (seen) markRead();
  }, [seen, chat.messages, markRead]);
  // A toast showing when the chat comes into view is stale.
  useEffect(() => {
    if (seen) dismissToast();
  }, [seen, dismissToast]);
  const closeChat = useCallback(() => {
    setOverlayOpen(false);
    if (sideTab === 'chat') markRead();
    chatButton.current?.focus();
  }, [markRead, sideTab]);

  const applyStage = useCallback((next: StageState) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const onMessage = useCallback(
    (msg: SyncMessage) => {
      if (msg.t !== 'stage') return;
      const prev = stageRef.current;
      const next = applyRemoteStage(prev, msg);
      if (next === prev) return;
      applyStage(next);
      // A late-join hand-off (sync) only catches us up; real changes are announced.
      if (!msg.sync && next.stage !== prev.stage) {
        showToast(t(msg.by === 'teacher' ? 'room.teacherOpened' : 'room.studentOpened', { stage: t(STAGE_KEY[next.stage]) }));
      }
    },
    [applyStage, showToast, t],
  );
  const send = useSync(onMessage);

  const changeStage = useCallback(
    (target: Stage) => {
      const next = localStageChange(stageRef.current, target, member.role);
      applyStage(next);
      send({ t: 'stage', stage: next.stage, lamport: next.lamport, by: member.role }).catch(() => {});
    },
    [applyStage, member.role, send],
  );

  // Someone who joins late receives the current stage.
  useEffect(() => {
    const onJoin = (p: Participant) => {
      if (p === room.localParticipant) return;
      const s = stageRef.current;
      if (s.by) {
        send({ t: 'stage', stage: s.stage, lamport: s.lamport, by: s.by, sync: true }, { to: [p.identity] }).catch(() => {});
      }
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantActive, onJoin);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      room.off(RoomEvent.ParticipantActive, onJoin);
    };
  }, [room, send]);

  // One screen share at a time: the newest share wins.
  useEffect(() => {
    const onRemotePublished = (pub: RemoteTrackPublication) => {
      const lp = room.localParticipant;
      if (shouldStopLocalShare(lp.isScreenShareEnabled, pub.source === Track.Source.ScreenShare)) {
        lp.setScreenShareEnabled(false).catch(() => {});
      }
    };
    const onLocalUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      const remoteActive = [...room.remoteParticipants.values()].some((p) => p.isScreenShareEnabled);
      const next = stageAfterLocalShareEnded(stageRef.current.stage, remoteActive);
      if (next) changeStage(next);
    };
    room.on(RoomEvent.TrackPublished, onRemotePublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => {
      room.off(RoomEvent.TrackPublished, onRemotePublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    };
  }, [room, changeStage]);

  const toggleShare = useCallback(async () => {
    if (localParticipant.isScreenShareEnabled) {
      await localParticipant.setScreenShareEnabled(false).catch(() => {});
      return;
    }
    try {
      await localParticipant.setScreenShareEnabled(true, SCREEN_CAPTURE);
      changeStage('screen');
    } catch (err) {
      if (!isUserCancel(err)) showToast(t('room.shareFailed'));
    }
  }, [localParticipant, changeStage, showToast, t]);

  const toggleBoard = useCallback(() => {
    changeStage(stageRef.current.stage === 'board' ? 'cameras' : 'board');
  }, [changeStage]);
  const showBoard = useCallback(() => {
    if (stageRef.current.stage !== 'board') changeStage('board');
  }, [changeStage]);
  const toggleMedia = useCallback(() => {
    changeStage(stageRef.current.stage === 'media' ? 'cameras' : 'media');
  }, [changeStage]);
  const closeMedia = useCallback(() => changeStage('cameras'), [changeStage]);
  // An audio file picked on the board's Drive menu plays on the media stage.
  const openMedia = useCallback(
    (m: { kind: 'audio'; drive: DriveFile }) => {
      const handle = media.current;
      if (!handle) return showToast(t('media.failed'));
      if (stageRef.current.stage !== 'media') changeStage('media');
      handle.openAudio(m.drive);
    },
    [changeStage, showToast, t],
  );

  const onEnd = useCallback(async () => {
    // Save the board first (a few seconds at most): the last strokes must reach storage.
    const flush = board.current?.flush();
    if (flush) await withTimeout(flush, END_FLUSH_TIMEOUT_MS, false);
    try {
      await endLesson(lessonId);
    } catch {
      showToast(t('room.endFailed'));
      return;
    }
    await room.disconnect();
  }, [lessonId, room, showToast, t]);

  // A file dropped anywhere outside the board must not make the browser open it (and leave the lesson).
  // The board's own capture-phase handlers take drops on the board before they get here.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer?.types)) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  // A camera or mic that stops working mid-lesson.
  useEffect(() => {
    const onDeviceError = () => showToast(t('room.deviceStopped'));
    room.on(RoomEvent.MediaDevicesError, onDeviceError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceError);
    };
  }, [room, showToast, t]);

  // The camera rail (w-44) is shown on board, screen and media stages outside fullscreen.
  const dockOpen = docked && chatOpen;
  // Keep the fullscreen button clear of the open overlay panel (w-80 + p-2 on each side = 21rem, plus a gap).
  const fsButtonRight = chatOpen && !docked ? 'right-3 sm:right-[21.5rem]' : 'right-3';
  // One element, shown either docked in the rail or as the overlay. Both tabs stay mounted (the one not shown
  // is hidden), so a half-typed word or message survives a tab switch.
  const chatPanel = (
    <SidePanel
      open={chatOpen}
      docked={docked}
      tab={sideTab}
      onTab={setSideTab}
      chatUnread={chatUnseen}
      vocabNew={vocabNew}
      muted={chatMuted}
      onToggleMuted={toggleChatMuted}
      onClose={closeChat}
    >
      <div hidden={sideTab !== 'chat'} className={sideTab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <ChatPanel
          visible={chatShown}
          messages={chat.messages}
          send={chat.send}
          member={member}
          history={chat.history}
          draft={draft}
          onDraftChange={setDraft}
          focusInput={chatFocusPending}
          onInputFocused={() => setChatFocusPending(false)}
        />
      </div>
      <div hidden={sideTab !== 'vocab'} className={sideTab === 'vocab' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <VocabPanel
          words={vocab.words}
          status={vocab.status}
          member={member}
          add={vocab.add}
          update={vocab.update}
          remove={vocab.remove}
        />
      </div>
    </SidePanel>
  );
  const fullscreenButton = (cls: string) => (
    <button
      type="button"
      onClick={() => void toggleFs()}
      // On the board, F is Excalidraw's frame tool, so the hint does not mention it.
      title={fsActive ? t('room.exitFullscreenHint') : fullscreenKeyEnabled(visible) ? t('room.fullscreenHint') : t('room.fullscreen')}
      aria-label={fsActive ? t('room.exitFullscreen') : t('room.fullscreen')}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 shadow ${cls}`}
    >
      {fsActive ? <ExitFullscreenIcon /> : <FullscreenIcon />}
    </button>
  );

  const renderBar = (compact: boolean) => (
    <ControlBar
      screenSharing={isScreenShareEnabled}
      boardActive={visible === 'board'}
      onToggleBoard={toggleBoard}
      onToggleShare={() => void toggleShare()}
      mediaActive={visible === 'media'}
      onToggleMedia={toggleMedia}
      chatOpen={chatOpen}
      chatShown={chatShown}
      chatUnread={chatUnseen}
      onToggleChat={toggleChat}
      chatButtonRef={chatButton}
      onEnd={() => void onEnd()}
      planBUrl={planBUrl}
      startedAt={startedAt}
      compact={compact}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      {!fsActive && <StatusBar planBUrl={planBUrl} since={reconnectingSince} />}
      <div ref={fsRef} onMouseMove={pokeBar} data-stage={visible} className="relative flex min-h-0 flex-1 bg-paper">
        {/* In fullscreen only this element is shown, so the banner must live inside it. */}
        {fsActive && <StatusBar planBUrl={planBUrl} since={reconnectingSince} overlay />}
        {visible === 'cameras' && <CameraTiles variant="stage" />}
        <main className={visible === 'cameras' ? 'hidden' : 'min-w-0 flex-1'}>
          <div className={visible === 'board' ? 'h-full' : 'hidden'}>
            <Board
              lessonId={lessonId}
              member={member}
              visible={visible === 'board'}
              onError={(k) => showToast(t(k))}
              onShow={showBoard}
              flushRef={board}
              onOpenMedia={openMedia}
            />
          </div>
          {/* Mounted on every stage, like the board: the media and its sync survive stage changes. */}
          <div className={visible === 'media' ? 'h-full' : 'hidden'}>
            <MediaStage member={member} onError={(k) => showToast(t(k))} onClose={closeMedia} handleRef={media} />
          </div>
          {visible === 'screen' && <ScreenView onStop={() => localParticipant.setScreenShareEnabled(false).catch(() => {})} />}
        </main>
        {visible !== 'cameras' &&
          (fsActive ? (
            <FloatingCams />
          ) : (
            <aside
              className={`flex shrink-0 flex-col border-l border-line bg-surface ${dockOpen ? 'min-h-0 w-72 overflow-hidden' : 'w-44 overflow-y-auto'}`}
            >
              {/* Over the board's top-right Library button was a collision: the button lives in the rail instead. */}
              <div className="flex shrink-0 justify-start px-2 pt-2">{fullscreenButton('')}</div>
              <div className="shrink-0">
                <CameraTiles variant={dockOpen ? 'dock' : 'rail'} />
              </div>
              {docked && chatPanel}
            </aside>
          ))}

        {!railShown && !fsActive && fullscreenButton(`absolute top-3 z-10 ${fsButtonRight}`)}

        {/* Over the right of the stage on every stage and in fullscreen, never over the control bar:
            the bar is outside this box normally, and in fullscreen the panel stops above it.
            Beside the camera rail, not over it; on a phone it takes the whole width. */}
        {!docked && (
          <div className={overlayOpen ? `absolute ${railShown ? 'right-0 sm:right-44' : 'right-0'} top-0 z-20 w-full p-2 sm:w-auto ${fsActive ? 'bottom-20' : 'bottom-0'}` : 'hidden'}>
            {chatPanel}
          </div>
        )}

        {/* The exit control sits beside the bar, never in the top-right corner where the board has its own buttons. */}
        {fsActive && barVisible && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex items-center justify-center gap-2 px-2 [&>*]:pointer-events-auto">
            {renderBar(true)}
            {fullscreenButton('')}
          </div>
        )}

        <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          {toastMessage && (
            <div role="status" className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper shadow">
              {toastMessage}
            </div>
          )}
          <ChatToast state={toast} onOpen={openChatFromToast} onDismiss={dismissToast} onClose={closeToast} />
        </div>
      </div>
      {!fsActive && renderBar(false)}
      <RoomAudioRenderer />
    </div>
  );
}
