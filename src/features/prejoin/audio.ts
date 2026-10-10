'use client';

import { useEffect, useState } from 'react';

/** Root-mean-square level of 8-bit time-domain samples (128 = silence), from 0 to 1. */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const v of samples) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

export function useMicLevel(track?: MediaStreamTrack): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track) return;
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      setLevel(rmsLevel(buf));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [track]);
  return level;
}

/** Two-note chime on the chosen speaker. Resolves once it has been scheduled. */
export async function playTestSound(outputDeviceId?: string): Promise<void> {
  const ctx = new AudioContext();
  try {
    // The context can start suspended; wake it while we are still inside the click.
    await ctx.resume();
    // AudioContext.setSinkId exists in Chromium; elsewhere the default speaker plays.
    // Wait for the switch, otherwise the chime can finish before the new speaker is used.
    const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (outputDeviceId && sink.setSinkId) await sink.setSinkId(outputDeviceId).catch(() => {});

    const start = ctx.currentTime + 0.05;
    const notes = [
      { freq: 880, at: 0 },
      { freq: 659.25, at: 0.28 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // Short attack and a decay, so it sounds like a chime instead of a click.
      gain.gain.setValueAtTime(0.0001, start + n.at);
      gain.gain.exponentialRampToValueAtTime(0.35, start + n.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + n.at);
      osc.stop(start + n.at + 0.65);
    }
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    void ctx.close();
  }
}
