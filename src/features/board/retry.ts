const LOAD_RETRY_MS = [5000, 10000, 20000];
const LOAD_RETRY_MAX_MS = 30000;

/** Wait before retrying a failed board load: 5 s, 10 s, 20 s, then every 30 s. `attempt` counts from 0. */
export function loadRetryDelay(attempt: number): number {
  const i = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return LOAD_RETRY_MS[i] ?? LOAD_RETRY_MAX_MS;
}

/** The promise's value, or `fallback` when it rejects or takes longer than `ms`. Never rejects. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
