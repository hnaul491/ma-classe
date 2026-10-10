export function createSaveQueue(opts: {
  save: (scene: unknown) => Promise<void>;
  backup: (scene: unknown) => void;
  onFailures: (count: number) => void;
  delayMs?: number;
  retryMs?: number;
}) {
  const delayMs = opts.delayMs ?? 3000;
  const retryMs = opts.retryMs ?? 10000;
  let pending: unknown = undefined;
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  function arm(ms: number) {
    clearTimeout(timer);
    if (disposed) return;
    timer = setTimeout(() => void run(), ms);
  }

  /** Saves the latest pending scene. At most one save runs at a time. */
  function run(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (inFlight) return inFlight; // the in-flight save re-checks pending when it finishes
    if (disposed || !hasPending) return Promise.resolve();
    const scene = pending;
    hasPending = false;
    inFlight = (async () => {
      try {
        await opts.save(scene);
        failures = 0;
      } catch {
        failures += 1;
        try {
          opts.backup(scene);
        } catch {
          // A failing backup must not stop the retry.
        }
        opts.onFailures(failures);
        // Retry the newest scene we have; a newer push replaces it.
        if (!hasPending) {
          pending = scene;
          hasPending = true;
        }
      } finally {
        inFlight = null;
      }
      if (disposed) return;
      if (failures > 0) arm(retryMs);
      else if (hasPending) void run();
    })();
    return inFlight;
  }

  return {
    push(scene: unknown) {
      pending = scene;
      hasPending = true;
      arm(failures > 0 ? retryMs : delayMs);
    },
    /** Waits for any in-flight save, then saves the latest scene. True when everything is saved. */
    async flush(): Promise<boolean> {
      clearTimeout(timer);
      timer = undefined;
      for (;;) {
        if (inFlight) await inFlight;
        if (disposed || !hasPending) break;
        await run();
        if (failures > 0) break;
      }
      return failures === 0 && !hasPending;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
