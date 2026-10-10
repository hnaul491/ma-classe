'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

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

let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  try {
    ctx ??= new AudioContext();
  } catch {
    /* no Web Audio: stay silent */
  }
  return ctx;
}

/** Wakes the shared audio context on the first click or key: browsers keep it suspended until then. */
export function useAudioUnlock() {
  useEffect(() => {
    const events = ['pointerdown', 'keydown'] as const;
    const off = () => events.forEach((e) => window.removeEventListener(e, unlock));
    function unlock() {
      const c = audio();
      if (!c) return off();
      c.resume().then(
        () => {
          if (c.state === 'running') off();
        },
        () => {},
      );
    }
    events.forEach((e) => window.addEventListener(e, unlock));
    return off;
  }, []);
}

/** Soft two-note ding. Silent when muted or while the browser still blocks audio; never waits. */
export function playDing(): void {
  if (readMuted()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;
  try {
    const start = c.currentTime + 0.02;
    for (const n of [
      { freq: 880, at: 0 },
      { freq: 659.25, at: 0.14 },
    ]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0.0001, start + n.at);
      gain.gain.exponentialRampToValueAtTime(0.12, start + n.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + 0.3);
      osc.connect(gain).connect(c.destination);
      osc.start(start + n.at);
      osc.stop(start + n.at + 0.35);
    }
  } catch {
    /* fail silently */
  }
}
