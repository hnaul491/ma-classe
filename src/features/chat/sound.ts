'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'chat-muted';
const EVENT = 'chat-muted-change';

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Whether the chat sound is off, remembered in this browser. */
export function useChatMuted(): [boolean, () => void] {
  const muted = useSyncExternalStore(subscribe, readMuted, () => false);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, readMuted() ? '0' : '1');
    } catch {
      /* storage blocked: the toggle just does nothing */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [muted, toggle];
}

/** Soft two-note ding. Silent if the browser blocks audio. */
export async function playDing(): Promise<void> {
  if (readMuted()) return;
  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
    await ctx.resume();
    const start = ctx.currentTime + 0.02;
    for (const n of [
      { freq: 880, at: 0 },
      { freq: 659.25, at: 0.14 },
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0.0001, start + n.at);
      gain.gain.exponentialRampToValueAtTime(0.12, start + n.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + n.at);
      osc.stop(start + n.at + 0.35);
    }
    const done = ctx;
    setTimeout(() => void done.close().catch(() => {}), 900);
  } catch {
    void ctx?.close().catch(() => {});
  }
}
