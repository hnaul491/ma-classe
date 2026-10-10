export type Banner =
  | { kind: 'none' }
  | { kind: 'connecting' }
  | { kind: 'reconnecting'; suggestPlanB: boolean }
  | { kind: 'disconnected' };

const PLAN_B_AFTER_MS = 30_000;

/** `state` is a livekit-client ConnectionState value. */
export function bannerFor(state: string, reconnectingSince: number | null, now: number): Banner {
  switch (state) {
    case 'connecting':
      return { kind: 'connecting' };
    case 'reconnecting':
    case 'signalReconnecting':
      return {
        kind: 'reconnecting',
        suggestPlanB: reconnectingSince !== null && now - reconnectingSince > PLAN_B_AFTER_MS,
      };
    case 'disconnected':
      return { kind: 'disconnected' };
    default:
      return { kind: 'none' };
  }
}
