/**
 * Debounce with a max wait: runs `fn` `wait` ms after the last call, but no later than
 * `maxWait` ms after the first call of a burst, so long bursts still run regularly.
 */
export function createDebounce(fn: () => void, wait: number, maxWait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let burstStart: number | null = null;

  function run() {
    clearTimeout(timer);
    timer = undefined;
    burstStart = null;
    fn();
  }

  return {
    call() {
      const now = Date.now();
      if (burstStart === null) burstStart = now;
      clearTimeout(timer);
      timer = setTimeout(run, Math.max(0, Math.min(wait, burstStart + maxWait - now)));
    },
    /** Runs a pending call now. Does nothing when nothing is pending. */
    flush() {
      if (burstStart !== null) run();
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      burstStart = null;
    },
  };
}

export type Debounce = ReturnType<typeof createDebounce>;

export type ThrottleKind = 'leading' | 'trailing' | 'now';

export type Throttle<A> = {
  call(arg: A): void;
  now(arg: A): void;
  cancel(): void;
};

/**
 * Leading + trailing throttle: the first call runs at once; later calls inside the window
 * are collapsed into one trailing call with the latest argument when the window ends.
 * With `alwaysTrailing`, a lone leading call is also repeated as a trailing call, so the
 * final value is always sent once more (callers send that one reliably).
 */
export function createThrottle<A>(
  fn: (arg: A, kind: ThrottleKind) => void,
  ms: number,
  opts: { alwaysTrailing?: boolean } = {},
): Throttle<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { arg: A } | null = null;

  function fire(arg: A, kind: ThrottleKind) {
    last = Date.now();
    fn(arg, kind);
  }

  function arm(delay: number) {
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        if (!pending) return;
        const { arg } = pending;
        pending = null;
        fire(arg, 'trailing');
      }, delay);
    }
  }

  return {
    call(arg: A) {
      const now = Date.now();
      if (timer === undefined && now - last >= ms) {
        fire(arg, 'leading');
        if (opts.alwaysTrailing) {
          pending = { arg };
          arm(ms);
        }
        return;
      }
      pending = { arg };
      arm(Math.max(0, last + ms - now));
    },
    /** Sends at once, dropping any queued trailing call. */
    now(arg: A) {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
      fire(arg, 'now');
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}
