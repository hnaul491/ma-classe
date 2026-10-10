import { describe, expect, it, vi } from 'vitest';
import { classifyDriveFile, type DriveFile } from './classify';
import { DriveExportTooLarge } from './drive';
import { createDriveImport, type DriveImportDeps } from './importFlow';
import { DriveAuthError, DriveReauthRequired } from './token';

const pdf: DriveFile = { id: 'p1', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1 };
const slides: DriveFile = { id: 's1', name: 'Deck', mimeType: 'application/vnd.google-apps.presentation', sizeBytes: null };
const image: DriveFile = { id: 'i1', name: 'a.png', mimeType: 'image/png', sizeBytes: 1 };
const audio: DriveFile = { id: 'a1', name: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 };
const video: DriveFile = { id: 'v1', name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 1 };

function setup(over: Partial<DriveImportDeps> = {}) {
  let alive = true;
  let busy = false;
  const deps = {
    openPicker: vi.fn(async (): Promise<DriveFile | null> => pdf),
    getToken: vi.fn(async () => 'tok'),
    download: vi.fn(async (f: DriveFile) => new File(['x'], f.name, { type: f.mimeType })),
    classify: vi.fn(classifyDriveFile),
    place: vi.fn(async () => {}),
    toast: vi.fn(),
    askReconnect: vi.fn(),
    isAlive: () => alive,
    isBusy: () => busy,
    onBusyChange: vi.fn(),
    setDownloading: vi.fn(),
    ...over,
  } satisfies DriveImportDeps;
  const flow = createDriveImport(deps);
  return {
    deps,
    flow,
    kill: () => (alive = false),
    setBusy: (b: boolean) => (busy = b),
    /** Waits until the flow is no longer in flight. */
    settled: () => vi.waitFor(() => expect(flow.busy()).toBe(false)),
  };
}

describe('createDriveImport start()', () => {
  it('opens the picker synchronously, inside the click call', () => {
    const { deps, flow } = setup({ openPicker: vi.fn(() => new Promise<DriveFile | null>(() => {})) });
    flow.start();
    expect(deps.openPicker).toHaveBeenCalledTimes(1);
  });

  it('downloads and places a PDF, and an exported Doc / Slides as a PDF', async () => {
    const s = setup();
    s.flow.start();
    await s.settled();
    expect(s.deps.download).toHaveBeenCalledWith(pdf);
    expect(s.deps.place).toHaveBeenCalledWith('pdf', expect.objectContaining({ name: 'a.pdf' }));
    expect(s.deps.toast).not.toHaveBeenCalled();

    const s2 = setup({ openPicker: vi.fn(async () => slides) });
    s2.flow.start();
    await s2.settled();
    expect(s2.deps.place).toHaveBeenCalledWith('pdf', expect.any(File));
  });

  it('places an image as an image', async () => {
    const s = setup({ openPicker: vi.fn(async () => image) });
    s.flow.start();
    await s.settled();
    expect(s.deps.place).toHaveBeenCalledWith('image', expect.any(File));
  });

  it('shows the downloading state from download to the end, with no gap before placing', async () => {
    const calls: string[] = [];
    const s = setup({
      setDownloading: vi.fn((on: boolean) => void calls.push(on ? 'on' : 'off')),
      place: vi.fn(async () => void calls.push('place')),
    });
    s.flow.start();
    await s.settled();
    expect(calls).toEqual(['on', 'place', 'off']);
  });

  it('a cancelled pick does nothing and ends the flow', async () => {
    const onBusyChange = vi.fn();
    const s = setup({ openPicker: vi.fn(async () => null), onBusyChange });
    s.flow.start();
    await s.settled();
    expect(s.deps.download).not.toHaveBeenCalled();
    expect(s.deps.toast).not.toHaveBeenCalled();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('a second start while one is in flight is a no-op', async () => {
    let resolve!: (f: DriveFile | null) => void;
    const s = setup({ openPicker: vi.fn(() => new Promise<DriveFile | null>((r) => (resolve = r))) });
    s.flow.start();
    expect(s.flow.busy()).toBe(true);
    s.flow.start();
    expect(s.deps.openPicker).toHaveBeenCalledTimes(1);
    resolve(pdf);
    await s.settled();
    expect(s.deps.place).toHaveBeenCalledTimes(1);
    s.flow.start(); // a new one may start once it ended
    expect(s.deps.openPicker).toHaveBeenCalledTimes(2);
  });

  it('while another add is in progress, toasts board.busy and opens nothing', () => {
    const s = setup();
    s.setBusy(true);
    s.flow.start();
    expect(s.deps.openPicker).not.toHaveBeenCalled();
    expect(s.deps.toast).toHaveBeenCalledWith('board.busy');
    expect(s.flow.busy()).toBe(false);
  });

  it('when another add started during the pick, toasts board.busy instead of dropping the file', async () => {
    let resolve!: (f: DriveFile | null) => void;
    const s = setup({ openPicker: vi.fn(() => new Promise<DriveFile | null>((r) => (resolve = r))) });
    s.flow.start();
    s.setBusy(true);
    resolve(pdf);
    await s.settled();
    expect(s.deps.download).not.toHaveBeenCalled();
    expect(s.deps.toast).toHaveBeenCalledWith('board.busy');
  });

  it('audio with openMedia opens it on the media stage', async () => {
    const openMedia = vi.fn();
    const s = setup({ openPicker: vi.fn(async () => audio), openMedia });
    s.flow.start();
    await s.settled();
    expect(openMedia).toHaveBeenCalledWith({ kind: 'audio', drive: audio });
    expect(s.deps.download).not.toHaveBeenCalled();
    expect(s.deps.toast).not.toHaveBeenCalled();
  });

  it('audio without openMedia toasts drive.unsupported', async () => {
    const s = setup({ openPicker: vi.fn(async () => audio) });
    s.flow.start();
    await s.settled();
    expect(s.deps.toast).toHaveBeenCalledWith('drive.unsupported');
    expect(s.deps.download).not.toHaveBeenCalled();
  });

  it('a rejected file toasts its reason', async () => {
    const s = setup({ openPicker: vi.fn(async () => video) });
    s.flow.start();
    await s.settled();
    expect(s.deps.toast).toHaveBeenCalledWith('drive.video');
    const big = setup({ openPicker: vi.fn(async () => ({ ...pdf, sizeBytes: 31 * 1024 * 1024 })) });
    big.flow.start();
    await big.settled();
    expect(big.deps.toast).toHaveBeenCalledWith('drive.tooLarge');
    expect(big.deps.download).not.toHaveBeenCalled();
  });

  it('DriveExportTooLarge toasts drive.exportTooLarge', async () => {
    const s = setup({ openPicker: vi.fn(async () => slides), download: vi.fn(() => Promise.reject(new DriveExportTooLarge())) });
    s.flow.start();
    await s.settled();
    expect(s.deps.toast).toHaveBeenCalledWith('drive.exportTooLarge');
    expect(s.deps.setDownloading).toHaveBeenLastCalledWith(false);
  });

  it('a failed sign-in toasts drive.authCancelled', async () => {
    const s = setup({ openPicker: vi.fn(() => Promise.reject(new DriveAuthError('popup_blocked'))) });
    s.flow.start();
    await s.settled();
    expect(s.deps.toast).toHaveBeenCalledWith('drive.authCancelled');
  });

  it('any other error, thrown or rejected anywhere, toasts drive.failed', async () => {
    const thrown = setup({
      openPicker: vi.fn(() => {
        throw new Error('sync boom');
      }),
    });
    thrown.flow.start();
    await thrown.settled();
    expect(thrown.deps.toast).toHaveBeenCalledWith('drive.failed');

    const classify = setup({
      classify: vi.fn(() => {
        throw new Error('classify boom');
      }),
    });
    classify.flow.start();
    await classify.settled();
    expect(classify.deps.toast).toHaveBeenCalledWith('drive.failed');

    const place = setup({ place: vi.fn(() => Promise.reject(new Error('place boom'))) });
    place.flow.start();
    await place.settled();
    expect(place.deps.toast).toHaveBeenCalledWith('drive.failed');
  });

  it('a download that needs a new token asks to reconnect with that file (no toast)', async () => {
    const s = setup({ download: vi.fn(() => Promise.reject(new DriveReauthRequired())) });
    s.flow.start();
    await s.settled();
    expect(s.deps.askReconnect).toHaveBeenLastCalledWith(pdf);
    expect(s.deps.toast).not.toHaveBeenCalled();
    expect(s.deps.place).not.toHaveBeenCalled();
  });

  it('not alive after the pick: nothing is downloaded, placed or toasted', async () => {
    let resolve!: (f: DriveFile | null) => void;
    const s = setup({ openPicker: vi.fn(() => new Promise<DriveFile | null>((r) => (resolve = r))) });
    s.flow.start();
    s.kill();
    resolve(pdf);
    await s.settled();
    expect(s.deps.download).not.toHaveBeenCalled();
    expect(s.deps.place).not.toHaveBeenCalled();
    expect(s.deps.toast).not.toHaveBeenCalled();
  });

  it('not alive after the download: nothing is placed or toasted', async () => {
    let resolve!: (f: File) => void;
    const s = setup({ download: vi.fn(() => new Promise<File>((r) => (resolve = r))) });
    s.flow.start();
    await vi.waitFor(() => expect(s.deps.download).toHaveBeenCalled());
    s.kill();
    resolve(new File(['x'], 'a.pdf'));
    await s.settled();
    expect(s.deps.place).not.toHaveBeenCalled();
    expect(s.deps.toast).not.toHaveBeenCalled();
  });

  it('not alive when an error arrives: no toast', async () => {
    let reject!: (e: unknown) => void;
    const s = setup({ download: vi.fn(() => new Promise<File>((_, r) => (reject = r))) });
    s.flow.start();
    await vi.waitFor(() => expect(s.deps.download).toHaveBeenCalled());
    s.kill();
    reject(new Error('offline'));
    await s.settled();
    expect(s.deps.toast).not.toHaveBeenCalled();
  });
});

describe('createDriveImport reconnect()', () => {
  it('asks for the token synchronously, inside the click call', () => {
    const s = setup({ getToken: vi.fn(() => new Promise<string>(() => {})) });
    s.flow.reconnect(pdf);
    expect(s.deps.getToken).toHaveBeenCalledTimes(1);
  });

  it('retries the same file once the token is back, and hides the notice', async () => {
    const s = setup();
    s.flow.reconnect(slides);
    await s.settled();
    expect(s.deps.askReconnect).toHaveBeenCalledWith(null);
    expect(s.deps.download).toHaveBeenCalledWith(slides);
    expect(s.deps.place).toHaveBeenCalledWith('pdf', expect.any(File));
    expect(s.deps.openPicker).not.toHaveBeenCalled();
  });

  it('a failed reconnect keeps the notice (so the person can try again) and toasts', async () => {
    const s = setup({ getToken: vi.fn(() => Promise.reject(new DriveAuthError('cancelled'))) });
    s.flow.reconnect(pdf);
    await s.settled();
    expect(s.deps.askReconnect).not.toHaveBeenCalled();
    expect(s.deps.toast).toHaveBeenCalledWith('drive.authCancelled');
    expect(s.deps.download).not.toHaveBeenCalled();
  });

  it('is a no-op while an import is in flight', () => {
    const s = setup({ openPicker: vi.fn(() => new Promise<DriveFile | null>(() => {})) });
    s.flow.start();
    s.flow.reconnect(pdf);
    expect(s.deps.getToken).not.toHaveBeenCalled();
  });

  it('while another add is in progress, toasts board.busy and keeps the notice', () => {
    const s = setup();
    s.setBusy(true);
    s.flow.reconnect(pdf);
    expect(s.deps.getToken).not.toHaveBeenCalled();
    expect(s.deps.toast).toHaveBeenCalledWith('board.busy');
    expect(s.deps.askReconnect).not.toHaveBeenCalled();
  });
});
