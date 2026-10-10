// Minimal ambient types for the Google scripts loaded at runtime (no npm package):
// - Google Identity Services token client (https://accounts.google.com/gsi/client)
// - Google Picker through gapi (https://apis.google.com/js/api.js)
// Only what the app uses. Read them through `window.google` / `window.gapi`: they exist only once loaded.

declare namespace google.accounts.oauth2 {
  /** The token response. `expires_in` is in seconds; `scope` lists the granted scopes, space-separated. */
  interface TokenResponse {
    access_token?: string;
    expires_in?: number | string;
    scope?: string;
    error?: string;
    error_description?: string;
  }

  /** Pop-up errors: the person closed it, or it was blocked. */
  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string;
    message?: string;
  }

  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
  }

  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: string }): void;
  }

  function initTokenClient(config: TokenClientConfig): TokenClient;
}

declare namespace google.picker {
  /** A picked document. `sizeBytes` is a string, and missing for Google-native files. */
  interface PickerDocument {
    id?: string;
    name?: string;
    mimeType?: string;
    sizeBytes?: string | number;
    [key: string]: unknown;
  }

  interface ResponseObject {
    action: string;
    docs?: PickerDocument[];
  }

  const Action: { PICKED: string; CANCEL: string; LOADED: string };
  const ViewId: { DOCS: string };

  class DocsView {
    constructor(viewId?: string);
    setIncludeFolders(included: boolean): DocsView;
    setMimeTypes(mimeTypes: string): DocsView;
  }

  interface Picker {
    setVisible(visible: boolean): Picker;
    dispose(): void;
  }

  class PickerBuilder {
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    addView(view: DocsView): PickerBuilder;
    setCallback(callback: (data: ResponseObject) => void): PickerBuilder;
    build(): Picker;
  }
}

declare namespace gapi {
  function load(api: string, callback: () => void): void;
}

interface Window {
  google?: { accounts?: { oauth2?: typeof google.accounts.oauth2 }; picker?: typeof google.picker };
  gapi?: typeof gapi;
}
