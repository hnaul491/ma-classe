'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';

/** Safety limit so a forgotten recording does not run forever. */
const MAX_SECONDS = 30;

type Phase = { kind: 'idle' } | { kind: 'recording'; seconds: number } | { kind: 'playing' };

/** Press to record from the preview mic, press again to stop and hear it back on the chosen speaker. */
export function MicTest({ track, outputDeviceId }: { track?: MediaStreamTrack; outputDeviceId?: string }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});

  // Stop recording or playback if the screen goes away mid-test.
  useEffect(() => () => cleanup.current(), []);

  function stop() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function start() {
    if (!track || phase.kind !== 'idle') return;
    // Record a clone so stopping the recorder can never stop the preview mic.
    const clone = track.clone();
    const recorder = new MediaRecorder(new MediaStream([clone]));
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    const timer: { id?: ReturnType<typeof setInterval> } = {};
    let audio: HTMLAudioElement | undefined;
    let url: string | undefined;

    cleanup.current = () => {
      clearInterval(timer.id);
      if (recorder.state !== 'inactive') recorder.stop();
      clone.stop();
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
    };

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      clearInterval(timer.id);
      clone.stop();
      recorderRef.current = null;
      if (chunks.length === 0) return setPhase({ kind: 'idle' });
      url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      audio = new Audio(url);
      const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (outputDeviceId && sink.setSinkId) await sink.setSinkId(outputDeviceId).catch(() => {});
      audio.onended = () => {
        if (url) URL.revokeObjectURL(url);
        setPhase({ kind: 'idle' });
      };
      setPhase({ kind: 'playing' });
      await audio.play().catch(() => setPhase({ kind: 'idle' }));
    };

    recorder.start();
    let seconds = 0;
    setPhase({ kind: 'recording', seconds });
    timer.id = setInterval(() => {
      seconds += 1;
      if (seconds >= MAX_SECONDS) {
        recorder.stop();
      } else {
        setPhase({ kind: 'recording', seconds });
      }
    }, 1000);
  }

  const recording = phase.kind === 'recording';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={!track || phase.kind === 'playing'}
          aria-pressed={recording}
          className={`btn btn-sm ${recording ? 'btn-danger' : 'btn-secondary'}`}
        >
          {recording && <span className="size-2 rounded-full bg-surface motion-safe:animate-pulse" aria-hidden />}
          {recording ? t('prejoin.micStop') : t('prejoin.micTest')}
        </button>
        <span aria-live="polite" className="text-sm text-muted">
          {recording && t('prejoin.micRecording', { s: phase.seconds })}
          {phase.kind === 'playing' && t('prejoin.micPlaying')}
        </span>
      </div>
      {!track && <p className="text-xs text-muted">{t('prejoin.micUnavailable')}</p>}
    </div>
  );
}
