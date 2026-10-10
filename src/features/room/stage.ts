import type { Stage } from '@/features/sync/protocol';
import type { Role } from '@/lib/lessons/types';

export interface StageState {
  stage: Stage;
  lamport: number;
  by: Role | null;
}

export const initialStage: StageState = { stage: 'cameras', lamport: 0, by: null };

export function localStageChange(s: StageState, stage: Stage, by: Role): StageState {
  return { stage, lamport: s.lamport + 1, by };
}

/** Higher counter wins; on a tie the teacher wins, so both sides converge. */
export function applyRemoteStage(s: StageState, msg: { stage: Stage; lamport: number; by: Role }): StageState {
  if (msg.lamport > s.lamport) return { stage: msg.stage, lamport: msg.lamport, by: msg.by };
  if (msg.lamport === s.lamport && msg.by === 'teacher' && s.by !== 'teacher') {
    return { stage: msg.stage, lamport: msg.lamport, by: msg.by };
  }
  return s;
}

export function resolveVisibleStage(
  stage: Stage,
  ctx: { screenActive: boolean; available: readonly Stage[] },
): Stage {
  if (!ctx.available.includes(stage)) return 'cameras';
  if (stage === 'screen' && !ctx.screenActive) return 'cameras';
  return stage;
}

export function shouldStopLocalShare(localSharing: boolean, remotePublishedScreen: boolean): boolean {
  return localSharing && remotePublishedScreen;
}

export function stageAfterLocalShareEnded(current: Stage, remoteShareActive: boolean): Stage | null {
  if (current !== 'screen') return null;
  return remoteShareActive ? null : 'cameras';
}
