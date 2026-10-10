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

  async function run(): Promise<void> {
    timer = undefined;
    if (!hasPending) return;
    const scene = pending;
    hasPending = false;
    try {
      await opts.save(scene);
      failures = 0;
    } catch {
      failures += 1;
      opts.backup(scene);
      opts.onFailures(failures);
      // Retry the newest scene we have; a newer push replaces it.
      if (!hasPending) {
        pending = scene;
        hasPending = true;
      }
      timer = setTimeout(() => void run(), retryMs);
    }
  }

  return {
    push(scene: unknown) {
      pending = scene;
      hasPending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), failures > 0 ? retryMs : delayMs);
    },
    async flush() {
      clearTimeout(timer);
      await run();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
