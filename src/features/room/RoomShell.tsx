'use client';

import dynamic from 'next/dynamic';
import { RoomAudioRenderer, useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { RoomEvent, Track, type LocalTrackPublication, type Participant, type RemoteTrackPublication } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endLesson } from '@/app/actions';
import { CameraTiles } from '@/features/stage/CameraTiles';
import { ScreenView } from '@/features/stage/ScreenView';
import { useT } from '@/lib/i18n/client';
import type { Stage, SyncMessage } from '@/features/sync/protocol';
import { useSync } from '@/features/sync/useSync';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Member } from '@/lib/lessons/types';
import { ControlBar } from './ControlBar';
import { FloatingCams } from './FloatingCams';
import { ExitFullscreenIcon, FullscreenIcon } from './icons';
import { isUserCancel } from './keys';
import { SCREEN_CAPTURE } from './roomOptions';
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
import { useToast } from './useToast';

const Board = dynamic(() => import('@/features/stage/Board'), { ssr: false });

/** Stage modules built so far. Plan 3 adds 'media'. */
const AVAILABLE: readonly Stage[] = ['cameras', 'board', 'screen'];
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
  const { ref: fsRef, active: fsActive, toggle: toggleFs } = useFullscreen<HTMLDivElement>();
  const { visible: barVisible, poke: pokeBar } = useAutoHide(fsActive);
  const reconnectingSince = useReconnectingSince();

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

  const onEnd = useCallback(async () => {
    try {
      await endLesson(lessonId);
    } catch {
      showToast(t('room.endFailed'));
      return;
    }
    await room.disconnect();
  }, [lessonId, room, showToast, t]);

  // A camera or mic that stops working mid-lesson.
  useEffect(() => {
    const onDeviceError = () => showToast(t('room.deviceStopped'));
    room.on(RoomEvent.MediaDevicesError, onDeviceError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceError);
    };
  }, [room, showToast, t]);

  const visible = resolveVisibleStage(stage.stage, { screenActive: screenTracks.length > 0, available: AVAILABLE });
  const renderBar = (compact: boolean) => (
    <ControlBar
      screenSharing={isScreenShareEnabled}
      boardActive={visible === 'board'}
      onToggleBoard={toggleBoard}
      onToggleShare={() => void toggleShare()}
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
            <Board lessonId={lessonId} member={member} visible={visible === 'board'} onError={(k) => showToast(t(k))} />
          </div>
          {visible === 'screen' && <ScreenView onStop={() => localParticipant.setScreenShareEnabled(false).catch(() => {})} />}
        </main>
        {visible !== 'cameras' &&
          (fsActive ? (
            <FloatingCams />
          ) : (
            <aside className="w-44 shrink-0 overflow-y-auto border-l border-line bg-surface">
              <CameraTiles variant="rail" />
            </aside>
          ))}

        {(!fsActive || barVisible) && (
          <button
            type="button"
            onClick={() => void toggleFs()}
            title={fsActive ? t('room.exitFullscreenHint') : t('room.fullscreenHint')}
            aria-label={fsActive ? t('room.exitFullscreen') : t('room.fullscreen')}
            className={`absolute top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 shadow ${visible === 'cameras' || fsActive ? 'right-3' : 'right-48'}`}
          >
            {fsActive ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        )}

        {fsActive && barVisible && <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">{renderBar(true)}</div>}

        {toastMessage && (
          <div role="status" className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-sm text-paper shadow">
            {toastMessage}
          </div>
        )}
      </div>
      {!fsActive && renderBar(false)}
      <RoomAudioRenderer />
    </div>
  );
}
