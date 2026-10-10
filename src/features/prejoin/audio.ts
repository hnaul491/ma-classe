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

export function playTestSound(outputDeviceId?: string): void {
  const ctx = new AudioContext();
  // AudioContext.setSinkId exists in Chromium; elsewhere the default speaker plays.
  const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (outputDeviceId && sink.setSinkId) void sink.setSinkId(outputDeviceId).catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  gain.gain.value = 0.15;
  osc.connect(gain).connect(ctx.destination);
  osc.onended = () => void ctx.close();
  osc.start();
  osc.stop(ctx.currentTime + 0.6);
}
