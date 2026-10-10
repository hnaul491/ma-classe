import { describe, expect, it, vi } from 'vitest';
import { loadObjectUrl } from './objectUrl';

function deps() {
  let n = 0;
  return { create: vi.fn((b: Blob) => (void b, `blob:${++n}`)), revoke: vi.fn((u: string) => void u) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('loadObjectUrl', () => {
  it('gives the object URL once loaded, and revokes it when the source changes or on unmount', async () => {
    const d = deps();
    const done = vi.fn();
    const cancel = loadObjectUrl(async () => new Blob(['a']), d, done);
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith({ url: 'blob:1' }));
    expect(d.revoke).not.toHaveBeenCalled();
    cancel();
    expect(d.revoke).toHaveBeenCalledWith('blob:1');
    cancel();
    expect(d.revoke).toHaveBeenCalledTimes(1);
  });

  it('a download that finishes after the change never creates a URL (nothing to leak)', async () => {
    const d = deps();
    const done = vi.fn();
    const blob = deferred<Blob>();
    const cancel = loadObjectUrl(() => blob.promise, d, done);
    cancel();
    blob.resolve(new Blob(['a']));
    await Promise.resolve();
    await Promise.resolve();
    expect(d.create).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it('reports a failed download, unless already cancelled', async () => {
    const d = deps();
    const done = vi.fn();
    const err = new Error('403');
    loadObjectUrl(async () => Promise.reject(err), d, done);
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith({ error: err }));
    const late = vi.fn();
    const failing = deferred<Blob>();
    loadObjectUrl(() => failing.promise, d, late)();
    failing.reject(err);
    await Promise.resolve();
    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });
});
