import { describe, expect, it } from 'vitest';
import { createScriptLoader, type ScriptDocument } from './script';

type FakeScript = { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null };

function fakeDocument() {
  const added: FakeScript[] = [];
  const doc: ScriptDocument = {
    createElement: () => ({ src: '', async: false, onload: null, onerror: null }) as FakeScript as unknown as HTMLScriptElement,
    head: { appendChild: (s: Node) => (added.push(s as unknown as FakeScript), s) } as unknown as HTMLHeadElement,
  };
  return { doc, added };
}

describe('createScriptLoader', () => {
  it('adds each script once and shares the promise', async () => {
    const { doc, added } = fakeDocument();
    const load = createScriptLoader(() => doc);
    const a = load('https://accounts.google.com/gsi/client');
    const b = load('https://accounts.google.com/gsi/client');
    expect(a).toBe(b);
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe('https://accounts.google.com/gsi/client');
    expect(added[0].async).toBe(true);
    added[0].onload?.();
    await expect(a).resolves.toBeUndefined();
    await load('https://accounts.google.com/gsi/client');
    expect(added).toHaveLength(1);
  });

  it('forgets a failed load so a later call can try again', async () => {
    const { doc, added } = fakeDocument();
    const load = createScriptLoader(() => doc);
    const a = load('https://apis.google.com/js/api.js');
    added[0].onerror?.();
    await expect(a).rejects.toThrow('api.js');
    const b = load('https://apis.google.com/js/api.js');
    expect(b).not.toBe(a);
    expect(added).toHaveLength(2);
  });

  it('rejects on the server (no document) instead of touching the DOM', async () => {
    const load = createScriptLoader(() => undefined);
    await expect(load('https://apis.google.com/js/api.js')).rejects.toThrow('browser');
  });
});
