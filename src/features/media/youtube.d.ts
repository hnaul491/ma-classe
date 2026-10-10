// Minimal ambient types for the YouTube IFrame Player API (https://www.youtube.com/iframe_api), loaded
// at runtime (no npm package). Only what the app uses. Read it through `window.YT`: it exists only once
// the API has called `window.onYouTubeIframeAPIReady`.

declare namespace YT {
  interface PlayerEvent {
    target: Player;
  }

  /** `data` is a `YT.PlayerState` value (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued). */
  interface OnStateChangeEvent {
    target: Player;
    data: number;
  }

  /** `data` is the error code (2 bad id, 5 HTML5 error, 100 not found, 101 and 150 not embeddable). */
  interface OnErrorEvent {
    target: Player;
    data: number;
  }

  interface PlayerOptions {
    videoId?: string;
    width?: number | string;
    height?: number | string;
    /** The embed host, e.g. `https://www.youtube-nocookie.com`. */
    host?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: PlayerEvent) => void;
      onStateChange?: (e: OnStateChangeEvent) => void;
      onError?: (e: OnErrorEvent) => void;
    };
  }

  class Player {
    constructor(element: HTMLElement | string, options: PlayerOptions);
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getPlayerState(): number;
    destroy(): void;
  }
}

interface Window {
  YT?: { Player: typeof YT.Player };
  onYouTubeIframeAPIReady?: () => void;
}
