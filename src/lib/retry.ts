/** An error that retrying cannot fix, such as "This lesson has ended." */
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof FatalError) throw err;
      lastError = err;
      if (attempt < opts.attempts) await sleep(opts.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
