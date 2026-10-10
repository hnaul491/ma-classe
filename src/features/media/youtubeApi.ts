import { loadScript as loadPageScript } from '@/features/drive/script';

export const YOUTUBE_API_SRC = 'https://www.youtube.com/iframe_api';
/** The player embeds from here: no YouTube cookies until the video is played. */
export const YOUTUBE_HOST = 'https://www.youtube-nocookie.com';
/** The API script loads a second script before it is ready; give up after this. */
export const YOUTUBE_LOAD_TIMEOUT_MS = 15_000;

/** What the loader uses of `window` (injectable for tests). */
export type YouTubeWindow = Pick<Window, 'YT' | 'onYouTubeIframeAPIReady'>;

/**
 * A loader for the YouTube IFrame Player API, shared by every player on the page: the script is added
 * once and the promise kept. A failed or timed-out load is forgotten, so the next call tries again.
 */
export function createYouTubeLoader(deps: { loadScript: (src: string) => Promise<void>; getWindow: () => YouTubeWindow | undefined }) {
  let api: Promise<typeof YT.Player> | null = null;
  return function loadYouTube(): Promise<typeof YT.Player> {
    if (api) return api;
    const win = deps.getWindow();
    if (!win) return Promise.reject(new Error('Cannot load the YouTube player outside the browser'));
    if (win.YT?.Player) {
      api = Promise.resolve(win.YT.Player);
      return api;
    }
    const loading = new Promise<typeof YT.Player>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The YouTube player did not load')), YOUTUBE_LOAD_TIMEOUT_MS);
      const previous = win.onYouTubeIframeAPIReady;
      win.onYouTubeIframeAPIReady = () => {
        previous?.();
        clearTimeout(timer);
        if (win.YT?.Player) resolve(win.YT.Player);
        else reject(new Error('The YouTube player did not load'));
      };
      deps.loadScript(YOUTUBE_API_SRC).catch((e: unknown) => {
        clearTimeout(timer);
        reject(e);
      });
    }).catch((e: unknown) => {
      api = null;
      throw e;
    });
    api = loading;
    return loading;
  };
}

/** Loads the YouTube IFrame Player API once per page. Browser only. */
export const loadYouTube = createYouTubeLoader({
  loadScript: loadPageScript,
  getWindow: () => (typeof window === 'undefined' ? undefined : window),
});
