import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYouTubeLoader, YOUTUBE_API_SRC, YOUTUBE_HOST, YOUTUBE_LOAD_TIMEOUT_MS, type YouTubeWindow } from './youtubeApi';

class FakePlayer {}
const Player = FakePlayer as unknown as typeof YT.Player;

function setup(win: YouTubeWindow | undefined = {}) {
  const loadScript = vi.fn(async (src: string) => {
    void src;
  });
  const load = createYouTubeLoader({ loadScript, getWindow: () => win });
  return { win, loadScript, load };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createYouTubeLoader', () => {
  it('loads the IFrame API script once and resolves when YouTube says it is ready', async () => {
    const { win, loadScript, load } = setup();
    const a = load();
    const b = load();
    expect(a).toBe(b);
    expect(loadScript).toHaveBeenCalledTimes(1);
    expect(loadScript).toHaveBeenCalledWith(YOUTUBE_API_SRC);
    win!.YT = { Player };
    win!.onYouTubeIframeAPIReady!();
    await expect(a).resolves.toBe(Player);
    await expect(load()).resolves.toBe(Player);
    expect(loadScript).toHaveBeenCalledTimes(1);
  });

  it('keeps a ready handler someone else set', async () => {
    const other = vi.fn();
    const { win, load } = setup({ onYouTubeIframeAPIReady: other });
    const p = load();
    win!.YT = { Player };
    win!.onYouTubeIframeAPIReady!();
    await p;
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('uses the API already on the page without loading it again', async () => {
    const { loadScript, load } = setup({ YT: { Player } });
    await expect(load()).resolves.toBe(Player);
    expect(loadScript).not.toHaveBeenCalled();
  });

  it('a failed script load is forgotten, so the next call tries again', async () => {
    const { loadScript, load } = setup();
    loadScript.mockRejectedValueOnce(new Error('offline'));
    await expect(load()).rejects.toThrow('offline');
    void load();
    expect(loadScript).toHaveBeenCalledTimes(2);
  });

  it('gives up when YouTube never says it is ready', async () => {
    vi.useFakeTimers();
    const { loadScript, load } = setup();
    const p = load();
    const settled = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(YOUTUBE_LOAD_TIMEOUT_MS);
    await settled;
    void load();
    expect(loadScript).toHaveBeenCalledTimes(2);
  });

  it('rejects outside the browser', async () => {
    const loadScript = vi.fn(async () => {});
    await expect(createYouTubeLoader({ loadScript, getWindow: () => undefined })()).rejects.toThrow();
    expect(loadScript).not.toHaveBeenCalled();
  });

  it('embeds from the no-cookie host', () => {
    expect(YOUTUBE_HOST).toBe('https://www.youtube-nocookie.com');
  });
});
