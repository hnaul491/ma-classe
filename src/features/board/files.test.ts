import { describe, expect, it } from 'vitest';
import { sceneFileIds } from './files';

describe('sceneFileIds', () => {
  it('lists each image file id once', () => {
    const elements = [
      { id: '1', version: 1, versionNonce: 1, type: 'image', fileId: 'f1' },
      { id: '2', version: 1, versionNonce: 1, type: 'image', fileId: 'f2' },
      { id: '3', version: 1, versionNonce: 1, type: 'image', fileId: 'f1' },
      { id: '4', version: 1, versionNonce: 1, type: 'frame' },
      { id: '5', version: 1, versionNonce: 1, type: 'image', fileId: null },
    ];
    expect(sceneFileIds(elements)).toEqual(['f1', 'f2']);
  });

  it('is empty for an empty scene', () => {
    expect(sceneFileIds([])).toEqual([]);
  });
});
