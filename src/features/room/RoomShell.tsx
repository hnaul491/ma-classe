'use client';

import { RoomAudioRenderer, useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { RoomEvent, Track, type LocalTrackPublication, type Participant, type RemoteTrackPublication } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endLesson } from '@/app/actions';
import { CameraTiles } from '@/features/stage/CameraTiles';
import { ScreenView } from '@/features/stage/ScreenView';
import type { Stage, SyncMessage } from '@/features/sync/protocol';
import { useSync } from '@/features/sync/useSync';
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
import { StatusBar } from './StatusBar';
import { useAutoHide } from './useAutoHide';
import { useFullscreen } from './useFullscreen';
import { useToast } from './useToast';

/** Stage modules built so far. Plans 2 and 3 add 'board' and 'media'. */
const AVAILABLE: readonly Stage[] = ['cameras', 'screen'];
const STAGE_LABEL: Record<Stage, string> = {
  cameras: 'the cameras',
  board: 'the board',
  screen: 'a shared screen',
  media: 'a video',
};

export function RoomShell({ lessonId, member, planBUrl }: { lessonId: string; member: Member; planBUrl: string }) {
  const room = useRoomContext();
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const [stage, setStage] = useState<StageState>(initialStage);
  const stageRef = useRef(stage);
  const { message: toastMessage, show: showToast } = useToast();
  const fs = useFullscreen<HTMLDivElement>();
  const bar = useAutoHide(fs.active);

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
      if (prev.by !== null && next.stage !== prev.stage) {
        showToast(`${msg.by === 'teacher' ? 'Teacher' : 'Student'} opened ${STAGE_LABEL[next.stage]}`);
      }
    },
    [applyStage, showToast],
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
      if (s.by) send({ t: 'stage', stage: s.stage, lamport: s.lamport, by: s.by }, { to: [p.identity] }).catch(() => {});
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
      if (!isUserCancel(err)) showToast('Screen sharing failed. Try again, or share a single tab.');
    }
  }, [localParticipant, changeStage, showToast]);

  const onEnd = useCallback(async () => {
    if (member.role === 'teacher') {
      try {
        await endLesson(lessonId);
      } catch {
        showToast('Could not end the lesson. Check your connection and try again.');
        return;
      }
    }
    await room.disconnect();
  }, [member.role, lessonId, room, showToast]);

  // A camera or mic that stops working mid-lesson.
  useEffect(() => {
    const onDeviceError = () => showToast('Camera or microphone stopped working. Check it is plugged in, then turn it off and on.');
    room.on(RoomEvent.MediaDevicesError, onDeviceError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceError);
    };
  }, [room, showToast]);

  const visible = resolveVisibleStage(stage.stage, { screenActive: screenTracks.length > 0, available: AVAILABLE });
  const renderBar = (compact: boolean) => (
    <ControlBar
      role={member.role}
      screenSharing={isScreenShareEnabled}
      onToggleShare={() => void toggleShare()}
      onEnd={() => void onEnd()}
      planBUrl={planBUrl}
      compact={compact}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StatusBar planBUrl={planBUrl} />
      <div ref={fs.ref} onMouseMove={bar.poke} data-stage={visible} className="relative flex min-h-0 flex-1 bg-paper">
        {visible === 'cameras' ? (
          <CameraTiles variant="stage" />
        ) : (
          <>
            <main className="min-w-0 flex-1">
              <ScreenView onStop={() => localParticipant.setScreenShareEnabled(false).catch(() => {})} />
            </main>
            {fs.active ? (
              <FloatingCams />
            ) : (
              <aside className="w-44 shrink-0 overflow-y-auto border-l border-line bg-surface">
                <CameraTiles variant="rail" />
              </aside>
            )}
          </>
        )}

        {(!fs.active || bar.visible) && (
          <button
            type="button"
            onClick={() => void fs.toggle()}
            title={fs.active ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
            aria-label={fs.active ? 'Exit fullscreen' : 'Fullscreen'}
            className={`absolute top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 shadow ${visible === 'cameras' || fs.active ? 'right-3' : 'right-48'}`}
          >
            {fs.active ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        )}

        {fs.active && bar.visible && <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">{renderBar(true)}</div>}

        {toastMessage && (
          <div role="status" className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-sm text-paper shadow">
            {toastMessage}
          </div>
        )}
      </div>
      {!fs.active && renderBar(false)}
      <RoomAudioRenderer />
    </div>
  );
}
