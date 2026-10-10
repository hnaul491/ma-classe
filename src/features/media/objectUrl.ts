/**
 * Loads a blob and hands back an object URL for it. The returned cancel (for a source change or an
 * unmount) aborts the load and revokes that URL; a load that finishes after it never creates one, so
 * nothing leaks.
 */
export function loadObjectUrl(
  load: (signal: AbortSignal) => Promise<Blob>,
  deps: { create: (b: Blob) => string; revoke: (url: string) => void },
  done: (r: { url: string } | { error: unknown }) => void,
): () => void {
  let cancelled = false;
  let url: string | null = null;
  const abort = new AbortController();
  load(abort.signal).then(
    (blob) => {
      if (cancelled) return;
      url = deps.create(blob);
      done({ url });
    },
    (error: unknown) => {
      if (!cancelled) done({ error });
    },
  );
  return () => {
    if (cancelled) return;
    cancelled = true;
    abort.abort();
    if (url) deps.revoke(url);
  };
}
