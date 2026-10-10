export function createSaveQueue(opts: {
  save: (scene: unknown) => Promise<void>;
  backup: (scene: unknown) => void;
  onFailures: (count: number) => void;
  delayMs?: number;
  retryMs?: number;
  /** Longest a pushed scene waits while changes keep coming (the debounce alone would never fire). */
  maxWaitMs?: number;
}) {
  const delayMs = opts.delayMs ?? 3000;
  const retryMs = opts.retryMs ?? 10000;
  const maxWaitMs = opts.maxWaitMs ?? 15000;
  let pending: unknown = undefined;
  let hasPending = false;
  /** When the oldest unsaved push must be saved at the latest (null: nothing waiting). */
  let deadline: number | null = null;
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
    deadline = null;
    inFlight = (async () => {
      try {
        await Promise.resolve().then(() => opts.save(scene));
        failures = 0;
      } catch {
        failures += 1;
        try {
          opts.backup(scene);
        } catch {
          // A failing backup must not stop the retry.
        }
        try {
          opts.onFailures(failures);
        } catch {
          // A failing UI callback must not stop the retry.
        }
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
      const now = Date.now();
      if (deadline === null) deadline = now + maxWaitMs;
      arm(Math.max(0, Math.min(failures > 0 ? retryMs : delayMs, deadline - now)));
    },
    /** True while a scene is waiting, being saved, or failed and not saved since. */
    hasUnsaved(): boolean {
      return hasPending || inFlight !== null || failures > 0;
    },
    /** Waits for any in-flight save, then saves the latest scene. True when everything is saved. */
    async flush(): Promise<boolean> {
      clearTimeout(timer);
      timer = undefined;
      for (;;) {
        if (inFlight) {
          await inFlight;
          if (disposed || failures > 0) break;
          continue; // a chained save may have started
        }
        if (disposed || !hasPending) break;
        await run();
        if (failures > 0) break;
      }
      return failures === 0 && !hasPending && !inFlight;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
