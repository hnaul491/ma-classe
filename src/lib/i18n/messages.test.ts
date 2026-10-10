import { describe, expect, it } from 'vitest';
import { en, fr, formatLessonDate, isMessageKey, isValidTimeZone, pickLocale, translate } from './messages';

describe('translate', () => {
  it('returns the string for the chosen language', () => {
    expect(translate('en', 'home.startLesson')).toBe('Start lesson');
    expect(translate('fr', 'home.startLesson')).toBe('Commencer le cours');
  });

  it('fills {placeholders} and leaves unknown ones visible', () => {
    expect(translate('fr', 'screen.someoneSharing', { name: 'Teacher' })).toBe('Teacher partage son écran');
    expect(translate('en', 'screen.someoneSharing')).toBe('{name} is sharing their screen');
  });
});

describe('dictionaries', () => {
  it('French has a non-empty translation for every English key', () => {
    for (const key of Object.keys(en)) {
      expect(fr[key as keyof typeof en], key).toBeTruthy();
    }
  });

  it('French keeps the same placeholders as English', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(fr[key]), key).toBe(vars(en[key]));
    }
  });
});

describe('pickLocale', () => {
  it('a saved cookie wins', () => {
    expect(pickLocale('fr', 'en-US,en;q=0.9')).toBe('fr');
    expect(pickLocale('en', 'fr-FR')).toBe('en');
  });

  it('without a cookie, a French browser gets French and everything else English', () => {
    expect(pickLocale(undefined, 'fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(pickLocale(undefined, 'vi-VN,vi;q=0.9')).toBe('en');
    expect(pickLocale(undefined, null)).toBe('en');
    expect(pickLocale('de', null)).toBe('en');
  });
});

describe('isMessageKey', () => {
  it('accepts only known keys', () => {
    expect(isMessageKey('join.ended')).toBe(true);
    expect(isMessageKey('nope')).toBe(false);
    expect(isMessageKey(42)).toBe(false);
  });
});

describe('formatLessonDate', () => {
  it('formats in Paris time for each language', () => {
    expect(formatLessonDate('2026-10-14T16:00:00Z', 'en')).toBe('14 Oct');
    expect(formatLessonDate('2026-10-14T16:00:00Z', 'fr')).toBe('14 oct.');
  });

  it('uses the viewer time zone, and falls back to Paris when it is invalid', () => {
    expect(formatLessonDate('2026-10-14T20:00:00Z', 'en', 'Asia/Taipei')).toBe('15 Oct');
    expect(formatLessonDate('2026-10-14T20:00:00Z', 'en', 'Europe/Paris')).toBe('14 Oct');
    expect(formatLessonDate('2026-10-14T20:00:00Z', 'en', 'Mars/Olympus')).toBe('14 Oct');
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones only', () => {
    expect(isValidTimeZone('Asia/Taipei')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});
