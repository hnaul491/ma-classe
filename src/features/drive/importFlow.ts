import type { MessageKey } from '@/lib/i18n/messages';
import type { DriveFile, DriveFileKind } from './classify';
import { driveErrorKey } from './drive';
import { DriveReauthRequired } from './token';

export type DriveImportDeps = {
  /** Opens the Drive Picker (may open the Google sign-in pop-up): the picked file, or null on cancel. */
  openPicker: () => Promise<DriveFile | null>;
  /** An interactive token request (may open the pop-up), for Reconnect. */
  getToken: () => Promise<string>;
  /** Downloads the file without ever opening a pop-up (throws DriveReauthRequired instead). */
  download: (f: DriveFile) => Promise<File>;
  classify: (f: DriveFile) => DriveFileKind;
  /** Places a downloaded file on the board the upload's way (its own checks, progress and errors). */
  place: (kind: 'pdf' | 'image', file: File) => Promise<void>;
  /** Plays a picked audio file on the media stage. Without it, audio is refused. */
  openMedia?: (m: { kind: 'audio'; drive: DriveFile }) => void;
  toast: (key: MessageKey) => void;
  /** Shows the Reconnect notice for this file; null hides it. */
  askReconnect: (file: DriveFile | null) => void;
  /** False once the board has unmounted: the file is then dropped silently. */
  isAlive: () => boolean;
  /** True while another add (upload, paste, drop, document) is in progress. */
  isBusy: () => boolean;
  /** The import started or ended (e.g. to disable the menu item). */
  onBusyChange: (busy: boolean) => void;
  /** Shows or hides the "getting the file" progress. Placing takes it over, so there is no gap. */
  setDownloading: (on: boolean) => void;
};

/**
 * The board's "From Google Drive" flow, one import at a time. `start()` and `reconnect()` are called
 * from a click and open their pop-up synchronously, before any await, so browsers do not block it.
 */
export function createDriveImport(deps: DriveImportDeps) {
  let inFlight = false;

  /** Ends the flow, whatever happened. Every error reaches a toast (unless the board is gone). */
  async function run(flow: () => Promise<void>): Promise<void> {
    try {
      await flow();
    } catch (err) {
      if (deps.isAlive()) deps.toast(driveErrorKey(err));
    } finally {
      inFlight = false;
      deps.onBusyChange(false);
    }
  }

  function begin(): boolean {
    if (inFlight) return false;
    if (deps.isBusy()) {
      deps.toast('board.busy');
      return false;
    }
    inFlight = true;
    deps.onBusyChange(true);
    return true;
  }

  /** A promise for a call that may also throw synchronously. */
  function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return fn();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  async function addFile(file: DriveFile): Promise<void> {
    const c = deps.classify(file);
    if (c.kind === 'reject') return deps.toast(c.reason);
    if (c.kind === 'audio') {
      if (deps.openMedia) deps.openMedia({ kind: 'audio', drive: file });
      else deps.toast('drive.unsupported'); // no media stage to play it on
      return;
    }
    // Another add started while the Picker was open: say so rather than drop the file.
    if (deps.isBusy()) return deps.toast('board.busy');
    deps.setDownloading(true);
    try {
      let downloaded: File;
      try {
        downloaded = await deps.download(file);
      } catch (err) {
        if (!(err instanceof DriveReauthRequired)) throw err;
        if (deps.isAlive()) deps.askReconnect(file);
        return;
      }
      if (!deps.isAlive()) return;
      await deps.place(c.kind === 'image' ? 'image' : 'pdf', downloaded);
    } finally {
      deps.setDownloading(false);
    }
  }

  return {
    /** True from the click until the import ends (success, error or cancel). */
    busy: (): boolean => inFlight,

    /** "From Google Drive" was clicked. A no-op while an import is in flight. */
    start(): void {
      if (!begin()) return;
      deps.askReconnect(null);
      // First, with no await before it: a Google sign-in pop-up must open inside the click.
      const picked = call(deps.openPicker);
      void run(async () => {
        const file = await picked;
        if (!file || !deps.isAlive()) return;
        await addFile(file);
      });
    },

    /** "Reconnect Google Drive" was clicked for `file`: a new token, then the same file again. */
    reconnect(file: DriveFile): void {
      if (!begin()) return;
      // First, with no await before it: the sign-in pop-up must open inside the click.
      const token = call(deps.getToken);
      void run(async () => {
        await token; // on failure the notice stays, so the person can try again
        if (!deps.isAlive()) return;
        deps.askReconnect(null);
        await addFile(file);
      });
    },
  };
}

export type DriveImport = ReturnType<typeof createDriveImport>;
