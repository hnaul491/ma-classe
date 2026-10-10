export type ThemePref = 'light' | 'dark' | 'system';

export const THEME_COOKIE = 'theme';

/** A saved light/dark choice wins; anything else follows the computer's setting. */
export function pickTheme(cookie: string | undefined): ThemePref {
  return cookie === 'light' || cookie === 'dark' ? cookie : 'system';
}

/** Value for <html data-theme>; absent means "follow prefers-color-scheme". */
export function themeAttribute(pref: ThemePref): 'light' | 'dark' | undefined {
  return pref === 'system' ? undefined : pref;
}
