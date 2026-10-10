import { describe, expect, it } from 'vitest';
import { decode, encode } from './protocol';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('protocol', () => {
  it('round-trips a stage message', () => {
    const msg = { t: 'stage', stage: 'screen', lamport: 4, by: 'teacher' } as const;
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('keeps the sync flag on a late-join hand-off', () => {
    const msg = { t: 'stage', stage: 'screen', lamport: 4, by: 'teacher', sync: true } as const;
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('drops a sync flag that is not exactly true', () => {
    for (const sync of [false, 1, 'true', null]) {
      const decoded = decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'screen', lamport: 1, by: 'teacher', sync })));
      expect(decoded).toEqual({ t: 'stage', stage: 'screen', lamport: 1, by: 'teacher' });
    }
  });

  it('ignores a message from a newer or older protocol version (old tab after a deploy)', () => {
    expect(decode(bytes(JSON.stringify({ v: 2, t: 'stage', stage: 'screen', lamport: 1, by: 'teacher' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ t: 'stage', stage: 'screen', lamport: 1, by: 'teacher' })))).toBeNull();
  });

  it('ignores garbage and malformed fields without throwing', () => {
    expect(decode(bytes('not json'))).toBeNull();
    expect(decode(bytes('null'))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'kitchen', lamport: 1, by: 'teacher' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'board', lamport: 1.5, by: 'teacher' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'stage', stage: 'board', lamport: 1, by: 'admin' })))).toBeNull();
    expect(decode(bytes(JSON.stringify({ v: 1, t: 'unknown' })))).toBeNull();
  });
});
