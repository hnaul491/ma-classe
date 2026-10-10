import { describe, expect, it } from 'vitest';
import { pickTheme, themeAttribute } from './theme';

describe('pickTheme', () => {
  it('accepts a saved light or dark choice', () => {
    expect(pickTheme('light')).toBe('light');
    expect(pickTheme('dark')).toBe('dark');
  });

  it('falls back to following the computer for anything else', () => {
    expect(pickTheme('system')).toBe('system');
    expect(pickTheme(undefined)).toBe('system');
    expect(pickTheme('purple')).toBe('system');
  });
});

describe('themeAttribute', () => {
  it('sets data-theme only when the person chose light or dark', () => {
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('system')).toBeUndefined();
  });
});
