import { describe, expect, it } from 'vitest';
import { httpUrl } from './server';

describe('httpUrl', () => {
  it('turns the LiveKit WebSocket URL into the HTTP API URL', () => {
    expect(httpUrl('wss://ma-classe.livekit.cloud')).toBe('https://ma-classe.livekit.cloud');
    expect(httpUrl('ws://localhost:7880')).toBe('http://localhost:7880');
  });
});
