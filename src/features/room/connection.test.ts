import { describe, expect, it } from 'vitest';
import { bannerFor } from './connection';

describe('bannerFor', () => {
  it('shows nothing while connected', () => {
    expect(bannerFor('connected', null, 0)).toEqual({ kind: 'none' });
  });

  it('shows connecting on first connect', () => {
    expect(bannerFor('connecting', null, 0)).toEqual({ kind: 'connecting' });
  });

  it('shows reconnecting without Plan B for the first 30 seconds', () => {
    expect(bannerFor('reconnecting', 1_000, 30_999)).toEqual({ kind: 'reconnecting', suggestPlanB: false });
    expect(bannerFor('signalReconnecting', 1_000, 10_000)).toEqual({ kind: 'reconnecting', suggestPlanB: false });
  });

  it('suggests Plan B after 30 seconds of reconnecting', () => {
    expect(bannerFor('reconnecting', 1_000, 31_001)).toEqual({ kind: 'reconnecting', suggestPlanB: true });
  });

  it('shows disconnected', () => {
    expect(bannerFor('disconnected', null, 0)).toEqual({ kind: 'disconnected' });
  });
});
