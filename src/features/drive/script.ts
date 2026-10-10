/** What the loader needs from `document` (injectable for tests). */
export type ScriptDocument = Pick<Document, 'createElement' | 'head'>;

/**
 * A loader that adds each external script once and shares the promise. A failed load is forgotten,
 * so the next call tries again. On the server (no document) it rejects instead of touching the DOM.
 */
export function createScriptLoader(getDocument: () => ScriptDocument | undefined) {
  const loading = new Map<string, Promise<void>>();
  return function loadScript(src: string): Promise<void> {
    const cached = loading.get(src);
    if (cached) return cached;
    const doc = getDocument();
    if (!doc) return Promise.reject(new Error(`Cannot load ${src} outside the browser`));
    const promise = new Promise<void>((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading.delete(src);
        reject(new Error(`Failed to load ${src}`));
      };
      doc.head.appendChild(script);
    });
    loading.set(src, promise);
    return promise;
  };
}

/** Loads a script once per page. Safe to import on the server: `document` is read only when called. */
export const loadScript = createScriptLoader(() => (typeof document === 'undefined' ? undefined : document));
