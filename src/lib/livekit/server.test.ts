import { describe, expect, it } from 'vitest';
import { httpUrl, isNotFound } from './server';

describe('httpUrl', () => {
  it('turns the LiveKit WebSocket URL into the HTTP API URL', () => {
    expect(httpUrl('wss://ma-classe.livekit.cloud')).toBe('https://ma-classe.livekit.cloud');
    expect(httpUrl('ws://localhost:7880')).toBe('http://localhost:7880');
  });
});

describe('isNotFound', () => {
  it('is true for a LiveKit not-found error', () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ code: 'not_found', status: 404 })).toBe(true);
    expect(isNotFound({ code: 'not_found' })).toBe(true);
  });

  it('is false for other errors', () => {
    expect(isNotFound(new Error('boom'))).toBe(false);
    expect(isNotFound({ status: 500, code: 'internal' })).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
